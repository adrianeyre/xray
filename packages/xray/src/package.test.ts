import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { buildFixture, formatRoundTrip, roundTrip } from "@xray/fixtures";
import { formatVerifiedInstall, verifyInstall } from "@xray/site";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from "vitest";

import { ICON_FILES } from "../../site/src/brand.js";

import { pnpm } from "./pack.js";
import { readTarball } from "./tarball.js";

// What `pnpm add -g @adrianeyre/xray` installs, from the very tarball
// `pnpm publish` would upload, packed by the global setup. It is installed into
// a PNPM_HOME of its own, so neither this machine's global packages nor the
// repository's builds and dependencies can stand in for what the package ships.

const tarball = inject("tarball");
const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
};

const windows = process.platform === "win32";
let pnpmHome: string;
let installed: { stdout: string; stderr: string };

beforeAll(async () => {
  pnpmHome = await mkdtemp(join(tmpdir(), "xray-pnpm-home-"));
  // Its dependencies are fetched into a store of its own, in PNPM_HOME, as
  // they would be on a machine that has never installed them.
  installed = await pnpm(["add", "--global", tarball], {
    cwd: pnpmHome,
    env: xrayEnv(),
  });
}, 5 * 60_000);

afterAll(async () => {
  await rm(pnpmHome, { recursive: true, force: true });
});

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      stopTree(child, "SIGKILL");
    }
  }
});

/** The environment the installed `xray` runs in: this one, its PNPM_HOME's bin first on PATH. */
function xrayEnv(): NodeJS.ProcessEnv {
  const path =
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "PATH";
  return {
    ...process.env,
    PNPM_HOME: pnpmHome,
    [path]: `${join(pnpmHome, "bin")}${delimiter}${process.env[path] ?? ""}`,
    BROWSER: "none",
  };
}

/** Runs the `xray` on PATH, as a shell would; its `.cmd` shim, through one, on Windows. */
function spawnXray(args: readonly string[]): ChildProcess {
  const child = spawn(
    "xray",
    windows ? args.map((arg) => `"${arg}"`) : [...args],
    { env: xrayEnv(), shell: windows, cwd: pnpmHome },
  );
  children.push(child);
  return child;
}

interface Exit {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function exitOf(child: ChildProcess): Promise<Exit> {
  let stdout = "";
  let stderr = "";
  child.stdout
    ?.setEncoding("utf8")
    .on("data", (text: string) => (stdout += text));
  child.stderr
    ?.setEncoding("utf8")
    .on("data", (text: string) => (stderr += text));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function xray(args: readonly string[]): Promise<Exit> {
  return exitOf(spawnXray(args));
}

/** Stops `child` and, on Windows, the node process its shell started. */
function stopTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (windows && child.pid !== undefined) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
  } else {
    child.kill(signal);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("the packed tarball", () => {
  it("holds the binary, the bundled CLI, the engine and the web app, and the licence and notices", async () => {
    const files = [...(await readTarball(tarball)).keys()];

    expect(files.every((file) => file.startsWith("package/"))).toBe(true);
    expect(files).toEqual(
      expect.arrayContaining([
        "package/package.json",
        "package/README.md",
        "package/LICENSE",
        "package/THIRD-PARTY-NOTICES.md",
        "package/bin/xray.js",
        "package/dist/xray.js",
        "package/engine/Xray.Engine.dll",
        "package/engine/Xray.Engine.deps.json",
        "package/engine/Xray.Engine.runtimeconfig.json",
        "package/engine/ICSharpCode.Decompiler.dll",
        "package/engine/ICSharpCode.BamlDecompiler.dll",
        "package/web/index.html",
        ...ICON_FILES.map((file) => `package/web/${file}`),
      ]),
    );
    // Nothing else: whatever the web app's build named its assets, and its icons.
    const icons = ICON_FILES.map((file) => file.replaceAll(".", "\\.")).join(
      "|",
    );
    const shipped = new RegExp(
      `^package/(package\\.json|README\\.md|LICENSE|THIRD-PARTY-NOTICES\\.md|bin/xray\\.js|dist/xray\\.js|engine/[^/]+\\.(dll|json)|web/(index\\.html|${icons}|assets/[^/]+\\.(js|css|ttf)))$`,
    );
    expect(files.filter((file) => !shipped.test(file))).toEqual([]);
  });

  it("holds no Fixtures, test files, sources or symbols", async () => {
    const files = [...(await readTarball(tarball)).keys()];

    expect(
      files.filter((file) =>
        /fixture|[./-](test|spec)s?\b|vitest|\.(cs|csproj|sln|props|targets|ts|tsx|pdb|map)$/i.test(
          file,
        ),
      ),
    ).toEqual([]);
    // Nor anything the Fixtures build into, or any Assembly but the engine's.
    expect(
      files.filter(
        (file) =>
          /\.(dll|exe)$/i.test(file) && !file.startsWith("package/engine/"),
      ),
    ).toEqual([]);
  });

  it("bundles every module the binary runs but the package's own dependencies, which install with it", async () => {
    const files = await readTarball(tarball);
    const bundle = files.get("package/dist/xray.js")?.toString("utf8") ?? "";

    const imported = new Set(
      [...bundle.matchAll(/\b(?:from|import)\s*\(?\s*"([^"]+)"/g)].map(
        (match) => match[1],
      ),
    );
    expect(
      [...imported].filter((name) => !name?.startsWith("node:")).sort(),
    ).toEqual(Object.keys(manifest.dependencies).sort());
    expect(bundle).not.toMatch(/@xray\/fixtures|vitest/);
  });

  it("names the binary xray, and says which Node.js it needs", async () => {
    const files = await readTarball(tarball);
    const packed = JSON.parse(
      files.get("package/package.json")?.toString("utf8") ?? "{}",
    ) as Record<string, unknown>;

    expect(packed).toMatchObject({
      name: "@adrianeyre/xray",
      version: manifest.version,
      license: "MIT",
      type: "module",
      bin: { xray: "./bin/xray.js" },
      engines: { node: ">=26" },
      dependencies: manifest.dependencies,
    });
    expect(files.get("package/bin/xray.js")?.toString("utf8")).toMatch(
      /^#!\/usr\/bin\/env node\n/,
    );
  });
});

describe("pnpm add -g @adrianeyre/xray", () => {
  it("installs xray onto PATH", () => {
    expect(installed.stdout).toContain(
      `+ ${manifest.name} ${manifest.version}`,
    );
  });

  it(
    "passes xray doctor, with the engine it bundles, of its own version",
    async () => {
      const result = await xray(["doctor"]);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(result.stdout).toMatch(/^PASS {2}Node\.js {6}\d+\.\d+\.\d+$/m);
      expect(result.stdout).toMatch(/^PASS {2}\.NET SDK /m);
      expect(result.stdout).toMatch(
        new RegExp(
          `^PASS {2}Xray engine {2}${manifest.version.replaceAll(".", "\\.")}(\\+[0-9a-f]+)? \\(protocol \\d+, ICSharpCode\\.Decompiler `,
          "m",
        ),
      );
      expect(result.stdout).toContain("All 3 checks passed.\n");
    },
    2 * 60_000,
  );

  it(
    "Round-trips the arithmetic Fixture with xray reconstruct",
    async () => {
      const result = await roundTrip("arithmetic", async (assembly, output) => {
        const reconstructed = await xray([
          "reconstruct",
          assembly,
          "-o",
          output,
        ]);
        expect(reconstructed, reconstructed.stderr).toMatchObject({ code: 0 });
        expect(reconstructed.stdout).toContain("Full Reconstruction");
      });

      expect(result.passed, formatRoundTrip(result)).toBe(true);
    },
    10 * 60_000,
  );

  it(
    "serves the web app it bundles with xray ui, reconstructs there with the engine it bundles, and stops on Ctrl+C, deleting its Workspace",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const child = spawnXray(["ui", "--port", "0"]);
      const exited = exitOf(child);
      const { url, workspace } = await new Promise<{
        url: string;
        workspace: string;
      }>((resolve, reject) => {
        let stdout = "";
        child.stdout?.on("data", (text: string) => {
          stdout += text;
          const url = /^Xray is running at (\S+)\r?$/m.exec(stdout)?.[1];
          const workspace = /Workspace: (.+?)\r?$/m.exec(stdout)?.[1];
          if (url !== undefined && workspace !== undefined) {
            resolve({ url, workspace });
          }
        });
        void exited.then((exit) =>
          reject(
            new Error(
              `xray ui exited before it ran.\n${exit.stdout}${exit.stderr}`,
            ),
          ),
        );
      });

      // The page and every asset it loads, as the package ships them.
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('<div id="root"></div>');
      const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)];
      expect(assets).not.toEqual([]);
      for (const [, asset] of assets) {
        expect((await fetch(new URL(asset as string, url))).status, asset).toBe(
          200,
        );
      }

      const started = await fetch(new URL("api/reconstructions", url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: assemblyPath }),
      });
      expect(started.status).toBe(202);
      const { id, events } = (await started.json()) as {
        id: string;
        events: string;
      };
      const stream = await (await fetch(new URL(events, url))).text();
      const ended = JSON.parse(
        /^event: ended\ndata: (.+)$/m.exec(stream)?.[1] ?? "null",
      ) as { kind: string; report?: { outcome: string } } | null;
      expect(ended, stream).toMatchObject({
        kind: "reconstructed",
        report: { outcome: "full" },
      });
      const zip = await fetch(new URL(`api/reconstructions/${id}/zip`, url));
      expect(zip.status).toBe(200);
      expect(Buffer.from(await zip.arrayBuffer()).subarray(0, 4)).toEqual(
        Buffer.from("PK\x03\x04", "latin1"),
      );

      if (windows) {
        // Node cannot send a child process Ctrl+C on Windows; ending it is
        // what Task Manager would do, so its Workspace is left behind.
        stopTree(child, "SIGKILL");
        await exited;
        await rm(workspace, { recursive: true, force: true });
        return;
      }
      child.kill("SIGINT");
      const exit = await exited;
      expect(exit).toMatchObject({ code: 0, stderr: "" });
      expect(exit.stdout).toContain(
        "Xray has stopped, and its Workspace is deleted.\n",
      );
      expect(await exists(workspace)).toBe(false);
    },
    10 * 60_000,
  );
});

describe("the project site's install instructions", () => {
  it(
    "install, as written, with the tarball for the package, an xray of its version that passes xray doctor and prints the site's CLI reference",
    async () => {
      const verified = await verifyInstall({ packageSpec: tarball });

      expect(verified.passed, formatVerifiedInstall(verified)).toBe(true);
      expect(verified.installedVersion).toBe(manifest.version);
    },
    5 * 60_000,
  );
});

describe("docs/processes/releasing.md", () => {
  it("says what the tarball holds, every file of it, and nothing it does not", async () => {
    const doc = await readFile(
      new URL("../../../docs/processes/releasing.md", import.meta.url),
      "utf8",
    );
    const table = doc
      .slice(doc.indexOf("| Path in the package |"))
      .split("\n\n")[0] as string;
    // The first column of each row but the header and its rule.
    const documented = table
      .split("\n")
      .slice(2)
      .flatMap((row) => [...(row.split("|")[1] ?? "").matchAll(/`([^`]+)`/g)])
      .map((match) => match[1] as string);
    const files = [...(await readTarball(tarball)).keys()]
      .map((file) => file.slice("package/".length))
      .filter((file) => file !== "package.json");
    const covers = (path: string, file: string) =>
      path.endsWith("/") ? file.startsWith(path) : file === path;

    expect(
      files.filter((file) => !documented.some((path) => covers(path, file))),
    ).toEqual([]);
    expect(
      documented.filter((path) => !files.some((file) => covers(path, file))),
    ).toEqual([]);
  });
});
