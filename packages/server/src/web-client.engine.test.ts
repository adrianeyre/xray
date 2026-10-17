import { execFile } from "node:child_process";
import { openAsBlob } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  request,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFixture,
  formatRoundTrip,
  NATIVE_EXECUTABLE_FIXTURE,
  roundTrip,
} from "@xray/fixtures";
import type {
  RecoveredFiles as WebAppFiles,
  ReconstructionEvent as WebAppEvent,
} from "@xray/web/events";
import {
  filePath,
  listRecoveredFiles,
  readRecoveredFile,
  zipPath,
} from "@xray/web/files-client";
import { isBinary, languageOf } from "@xray/web/viewer-files";
import { inspectJsonText } from "@xray/web/inspect-summary";
import {
  followReconstruction,
  startReconstruction,
  type Connection,
  type Transport,
} from "@xray/web/reconstruction-client";
import { dependencyRows, OUTCOMES, reportDiagnostics } from "@xray/web/report";
import {
  uploadSelection,
  type Selection,
  type UploadProgress,
} from "@xray/web/upload-client";
import { afterEach, describe, expect, it } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

import type { RecoveredFiles } from "./api.js";
import type { ReconstructionEvent } from "./reconstructions.js";
import { SERVER_HOST, startServer, type XrayServer } from "./server.js";
import { extractZip, readZip } from "./test-zip.js";

// The web app's own client, with Node.js's EventSource, which connects again
// as a browser's does (run with --experimental-eventsource), following the
// server's streams of Reconstructions of the real Fixtures by the real engine.

/** What the server sends is what the web app reads: this compiles only if so. */
export const sentIsRead = (event: ReconstructionEvent): WebAppEvent => event;
export const listedIsRead = (files: RecoveredFiles): WebAppFiles => files;

const RECONSTRUCTION_TIMEOUT_MS = 5 * 60_000;

/** The `xray` binary, run as a user would. */
const XRAY = fileURLToPath(new URL("../../cli/bin/xray.js", import.meta.url));

/** What `xray inspect <path> --json` prints, on stdout and stderr, and its exit code. */
function inspectWithCli(
  path: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [XRAY, "inspect", path, "--json"],
      (error, stdout, stderr) =>
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
        }),
    );
  });
}

const transport: Transport = {
  fetch: (input, init) => fetch(input, init),
  openEventSource: (url) => new EventSource(url),
  // Node.js's fetch, which cannot tell how much it has sent until it has
  // sent the lot.
  put: async (url, body, onProgress) => {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body,
    });
    onProgress(body.size);
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as unknown,
    };
  },
};

const servers: XrayServer[] = [];
const proxies: Server[] = [];
afterEach(async () => {
  await Promise.all(
    proxies
      .splice(0)
      .map(
        (proxy) =>
          new Promise((resolve) => proxy.close(resolve).closeAllConnections()),
      ),
  );
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(): Promise<XrayServer> {
  const server = await startServer({ port: 0 });
  servers.push(server);
  return server;
}

/**
 * A proxy in front of `server` whose connections can be cut, as a network
 * that drops them does, while it goes on listening. Requests reach the server
 * as if sent to it directly.
 */
async function proxyTo(
  server: XrayServer,
): Promise<{ readonly base: string; readonly cut: () => void }> {
  const open = new Set<ServerResponse>();
  const proxy = createServer((incoming, outgoing) => {
    open.add(outgoing);
    outgoing.once("close", () => open.delete(outgoing));
    const forwarded = request(
      {
        host: SERVER_HOST,
        port: server.port,
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, host: `${SERVER_HOST}:${server.port}` },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => outgoing.destroy());
    outgoing.once("close", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  proxies.push(proxy);
  await new Promise<void>((resolve) =>
    proxy.listen({ host: SERVER_HOST, port: 0 }, resolve),
  );
  const { port } = proxy.address() as AddressInfo;
  return {
    base: `http://${SERVER_HOST}:${port}`,
    cut: () => {
      for (const response of open) {
        response.destroy();
      }
    },
  };
}

describe("the web app's client, following the server (against the real engine)", () => {
  it(
    "follows the arithmetic Fixture's Reconstruction through a lost connection, missing no event and repeating none",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const server = await start();
      const proxy = await proxyTo(server);
      const events: WebAppEvent[] = [];
      const connections: Connection["state"][] = [];
      let cut = false;

      const started = await startReconstruction(
        { path: assemblyPath },
        transport,
        proxy.base,
      );
      if (!started.ok) {
        throw new Error(started.message);
      }
      await new Promise<void>((resolve) => {
        followReconstruction(
          `${proxy.base}${started.started.events}`,
          {
            onEvent: (event) => {
              events.push(event);
              if (
                !cut &&
                event.type === "progress" &&
                event.data.kind === "stage-started" &&
                event.data.stage === "build"
              ) {
                cut = true;
                proxy.cut();
              }
            },
            onConnection: ({ state }) => {
              connections.push(state);
              if (state === "ended" || state === "lost") {
                resolve();
              }
            },
          },
          transport,
        );
      });

      expect(connections).toEqual([
        "connecting",
        "open",
        "reconnecting",
        "open",
        "ended",
      ]);
      const progress = events.flatMap((event) =>
        event.type === "progress" ? [event.data] : [],
      );
      expect(
        progress
          .filter((event) => event.kind !== "stage-progress")
          .map((event) => `${event.kind} ${event.stage}`),
      ).toEqual([
        "stage-started analyse",
        "stage-finished analyse",
        "stage-started decompile",
        "stage-finished decompile",
        "stage-started resolve-dependencies",
        "stage-finished resolve-dependencies",
        "stage-started generate",
        "stage-finished generate",
        "stage-started build",
        "stage-finished build",
        "stage-skipped run",
      ]);
      // Each once, in order: none sent again on connecting again.
      const times = progress.map((event) => event.elapsedMs);
      expect(times).toEqual(times.toSorted((a, b) => a - b));
      expect(new Set(progress.map((event) => JSON.stringify(event))).size).toBe(
        progress.length,
      );
      // The summary, once analyse has read it, before it finishes, however
      // many times analyse says it is still running before then.
      expect(
        events.flatMap((event) =>
          event.type !== "progress"
            ? [event.type]
            : event.data.kind === "stage-progress"
              ? []
              : [`${event.data.kind} ${event.data.stage}`],
        ),
      ).toEqual([
        "started",
        "stage-started analyse",
        "inspected",
        "stage-finished analyse",
        "stage-started decompile",
        "stage-finished decompile",
        "stage-started resolve-dependencies",
        "stage-finished resolve-dependencies",
        "stage-started generate",
        "stage-finished generate",
        "stage-started build",
        "stage-finished build",
        "stage-skipped run",
        "ended",
      ]);
      expect(events.at(-1)).toMatchObject({
        type: "ended",
        data: { kind: "reconstructed", report: { outcome: "full" } },
      });
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "is sent the arithmetic Fixture's inspect summary as xray inspect --json prints it, which the web app shows as it prints it",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const server = await start();
      const base = server.url.slice(0, -1);

      const started = await startReconstruction(
        { path: assemblyPath },
        transport,
        base,
      );
      if (!started.ok) {
        throw new Error(started.message);
      }
      const events = await follow(`${base}${started.started.events}`);
      const cli = await inspectWithCli(assemblyPath);

      expect(cli.code).toBe(0);
      const inspected = events.filter((event) => event.type === "inspected");
      expect(inspected).toHaveLength(1);
      const [{ data }] = inspected as [
        Extract<WebAppEvent, { type: "inspected" }>,
      ];
      expect(data).toEqual(JSON.parse(cli.stdout));
      expect(`${inspectJsonText(data)}\n`).toBe(cli.stdout);
      expect(data).toMatchObject({
        schemaVersion: 1,
        path: assemblyPath,
        assembly: { name: "Arithmetic" },
        targetFramework: { moniker: "net8.0" },
        outputKind: "console",
      });
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "browses every file of the arithmetic Fixture's Recovered Solution, each exactly as the Reconstruction wrote it, and nothing dotnet build made beside them",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const server = await start();
      const base = server.url.slice(0, -1);

      const started = await startReconstruction(
        { path: assemblyPath },
        transport,
        base,
      );
      if (!started.ok) {
        throw new Error(started.message);
      }
      const { id } = started.started;
      const events = await follow(`${base}${started.started.events}`);
      const ended = events.at(-1) as Extract<WebAppEvent, { type: "ended" }>;
      expect(ended.data).toMatchObject({
        kind: "reconstructed",
        report: { outcome: "full" },
      });
      // The report panel's success: built, without an error.
      if (ended.data.kind === "reconstructed") {
        expect(ended.data.report.build?.succeeded).toBe(true);
        expect(
          reportDiagnostics(ended.data.report).filter(
            ({ diagnostic }) => diagnostic.severity === "error",
          ),
        ).toEqual([]);
      }
      const directory = join(server.workspace, "reconstructions", id);
      const listed = await listRecoveredFiles(id, transport, base);
      if (!listed.ok) {
        throw new Error(listed.message);
      }

      // As xray-report.json lists them, report last.
      const report = JSON.parse(
        await readFile(join(directory, "xray-report.json"), "utf8"),
      ) as { solution: { files: string[] } };
      expect(listed.files.map((file) => file.path)).toEqual(
        report.solution.files,
      );
      expect(report.solution.files).toEqual([
        "Arithmetic.sln",
        "Arithmetic/Arithmetic.csproj",
        "Arithmetic/Properties/AssemblyInfo.cs",
        "Arithmetic/Program.cs",
        "xray-report.json",
      ]);
      // Built: bin/ and obj/ are there, but not browsed.
      const onDisk = (await readdir(directory, { recursive: true })).map(
        (path) => path.split(sep).join("/"),
      );
      expect(onDisk.some((path) => path.startsWith("Arithmetic/bin/"))).toBe(
        true,
      );
      for (const { path, size } of listed.files) {
        const written = await readFile(join(directory, ...path.split("/")));
        const read = await readRecoveredFile(
          id,
          path,
          transport,
          undefined,
          base,
        );

        expect(size, path).toBe(written.length);
        expect(read, path).toEqual({
          ok: true,
          text: new TextDecoder().decode(written),
        });
      }
      const program = await readRecoveredFile(
        id,
        "Arithmetic/Program.cs",
        transport,
        undefined,
        base,
      );
      expect(program.ok && program.text).toContain("namespace Arithmetic");
      // A file dotnet build made, beside them, is not sent.
      const built = await fetch(
        `${base}${filePath(id, "Arithmetic/bin/Debug/net8.0/Arithmetic.dll")}`,
      );
      expect(built.status).toBe(404);
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "Round-trips the arithmetic Fixture through the zip archive the web app downloads: it extracts, with the system's own tool, to its Recovered Solution, without what dotnet build made, which builds, and behaves as the original does",
    async () => {
      const server = await start();
      const base = server.url.slice(0, -1);
      const downloads = await mkdtemp(join(tmpdir(), "xray-download-test-"));
      try {
        const result = await roundTrip(
          "arithmetic",
          async (assemblyPath, outputDirectory) => {
            const started = await startReconstruction(
              { path: assemblyPath },
              transport,
              base,
            );
            if (!started.ok) {
              throw new Error(started.message);
            }
            const { id } = started.started;
            const events = await follow(`${base}${started.started.events}`);
            const ended = events.at(-1) as Extract<
              WebAppEvent,
              { type: "ended" }
            >;
            if (ended.data.kind !== "reconstructed") {
              throw new Error(
                `Not reconstructed: ${JSON.stringify(ended.data)}`,
              );
            }
            // Built, so bin/ and obj/ are beside it, for the archive to leave out.
            expect(ended.data.report.outcome).toBe("full");
            const onDisk = (
              await readdir(ended.data.directory, { recursive: true })
            ).map((path) => path.split(sep).join("/"));
            expect(onDisk).toContain("Arithmetic/bin");
            expect(onDisk).toContain("Arithmetic/obj");

            // As the page's button downloads it.
            const response = await fetch(`${base}${zipPath(id)}`);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe(
              "application/zip",
            );
            expect(response.headers.get("content-disposition")).toContain(
              'filename="Arithmetic.zip"',
            );
            const zip = Buffer.from(await response.arrayBuffer());
            expect(readZip(zip).map((file) => file.name)).toEqual(
              ended.data.report.solution.files.map(
                (path) => `Arithmetic/${path}`,
              ),
            );
            const saved = join(downloads, "Arithmetic.zip");
            await writeFile(saved, zip);
            const extracted = join(downloads, "extracted");
            await mkdir(extracted);
            await extractZip(saved, extracted);

            expect(await readdir(extracted)).toEqual(["Arithmetic"]);
            const files = (
              await readdir(join(extracted, "Arithmetic"), {
                recursive: true,
                withFileTypes: true,
              })
            )
              .filter((entry) => entry.isFile())
              .map((entry) =>
                relative(
                  join(extracted, "Arithmetic"),
                  join(entry.parentPath, entry.name),
                )
                  .split(sep)
                  .join("/"),
              );
            expect(files.sort()).toEqual(
              [...ended.data.report.solution.files].sort(),
            );
            // The Round-trip builds and runs what the archive extracted to.
            await rename(join(extracted, "Arithmetic"), outputDirectory);
          },
        );

        expect(result.passed, formatRoundTrip(result)).toBe(true);
      } finally {
        await rm(downloads, { recursive: true, force: true });
      }
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "leads each of the missing-reference Fixture's build errors, as the web app's report links them, to the file and line in its Recovered Solution that the error is about",
    async () => {
      const { assemblyPath } = await buildFixture("missing-reference");
      const server = await start();
      const base = server.url.slice(0, -1);

      const started = await startReconstruction(
        { path: assemblyPath },
        transport,
        base,
      );
      if (!started.ok) {
        throw new Error(started.message);
      }
      const { id } = started.started;
      const events = await follow(`${base}${started.started.events}`);
      const ended = events.at(-1) as Extract<WebAppEvent, { type: "ended" }>;
      if (ended.data.kind !== "reconstructed") {
        throw new Error(`Not reconstructed: ${JSON.stringify(ended.data)}`);
      }
      const { report } = ended.data;
      expect(report.outcome).toBe("partial");
      expect(OUTCOMES[report.outcome].title).toBe("Partial Reconstruction");
      // Its library is not beside it: the Unresolved Dependency is named
      // first among the reasons, and in the table, as the page shows them.
      expect(report.reasons[0]).toMatchObject({
        kind: "unresolved-dependencies",
        dependencies: [{ reference: { name: "Greetings" } }],
      });
      expect(
        dependencyRows(report).map(
          ({ name, resolvedAs, satisfiedBy }) =>
            `${name}: ${resolvedAs}, ${satisfiedBy ?? "-"}`,
        ),
      ).toEqual([
        "Greetings: Unresolved, -",
        "System.Console: Framework, -",
        "System.Runtime: Framework, -",
      ]);

      const diagnostics = reportDiagnostics(report);
      const errors = diagnostics.filter(
        ({ diagnostic }) => diagnostic.severity === "error",
      );
      expect(errors.length).toBeGreaterThan(0);
      // Every error the build failed with is listed, and each leads to a
      // file of the Recovered Solution, at a line.
      const failed = report.reasons.flatMap((reason) =>
        reason.kind === "build-failed" ? reason.errors : [],
      );
      expect(errors.map(({ diagnostic }) => diagnostic)).toEqual(failed);
      const listed = await listRecoveredFiles(id, transport, base);
      if (!listed.ok) {
        throw new Error(listed.message);
      }
      for (const { diagnostic, target } of errors) {
        const where = JSON.stringify(diagnostic);
        expect(target, where).not.toBeNull();
        if (target === null || target.line === null) {
          throw new Error(`No line: ${where}`);
        }
        expect(
          listed.files.map((file) => file.path),
          where,
        ).toContain(target.path);
        const read = await readRecoveredFile(
          id,
          target.path,
          transport,
          undefined,
          base,
        );
        if (!read.ok) {
          throw new Error(read.message);
        }
        // At that line and column is the name the error says it cannot find.
        const line = read.text.split(/\r?\n/)[target.line - 1] ?? "";
        const named = /'([^']+)'/.exec(diagnostic.message)?.[1];
        expect(named, where).toBeDefined();
        expect(
          line.slice((target.column ?? 1) - 1).startsWith(named ?? ""),
          `${where} at "${line}"`,
        ).toBe(true);
      }
      // The using directive the library's absence breaks.
      expect(errors[0]?.target).toEqual({
        path: "MissingReference/Program.cs",
        line: 2,
        column: 7,
      });
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "shows the copied-binary Fixture's every reference in the web app's Dependency Resolution table, its third party's library copied into Dependencies, listed, and downloaded byte for byte",
    async () => {
      const { assemblyPath } = await buildFixture("copied-binary");
      const vendor = join(assemblyPath, "..", "Kestrelwood.Checksums.dll");
      const server = await start();
      const base = server.url.slice(0, -1);

      const started = await startReconstruction(
        { path: assemblyPath },
        transport,
        base,
      );
      if (!started.ok) {
        throw new Error(started.message);
      }
      const { id } = started.started;
      const events = await follow(`${base}${started.started.events}`);
      const ended = events.at(-1) as Extract<WebAppEvent, { type: "ended" }>;
      if (ended.data.kind !== "reconstructed") {
        throw new Error(`Not reconstructed: ${JSON.stringify(ended.data)}`);
      }
      const { report } = ended.data;

      expect(report.outcome).toBe("full");
      expect(
        dependencyRows(report).map(
          ({
            name,
            identity,
            resolution,
            resolvedAs,
            satisfiedBy,
            referencedBy,
          }) => [
            name,
            identity,
            resolution,
            resolvedAs,
            satisfiedBy,
            referencedBy,
          ],
        ),
      ).toEqual([
        [
          "Kestrelwood.Checksums",
          "2.3.1.0, 51ca75d1f3633191",
          "copied-binary",
          "Copied binary",
          "Dependencies/Kestrelwood.Checksums.dll",
          "CopiedBinary",
        ],
        [
          "System.Console",
          "8.0.0.0, b03f5f7f11d50a3a",
          "framework",
          "Framework",
          null,
          "CopiedBinary",
        ],
        [
          "System.Runtime",
          "8.0.0.0, b03f5f7f11d50a3a",
          "framework",
          "Framework",
          null,
          "CopiedBinary",
        ],
      ]);
      const listed = await listRecoveredFiles(id, transport, base);
      if (!listed.ok) {
        throw new Error(listed.message);
      }
      expect(listed.files).toContainEqual({
        path: "Dependencies/Kestrelwood.Checksums.dll",
        size: (await stat(vendor)).size,
      });
      const zip = await fetch(`${base}${zipPath(id)}`);
      const entries = readZip(Buffer.from(await zip.arrayBuffer()));
      expect(
        entries.find(
          ({ name }) =>
            name === "CopiedBinary/Dependencies/Kestrelwood.Checksums.dll",
        )?.contents,
      ).toEqual(await readFile(vendor));
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "highlights the wpf Fixture's Recovered Solution as the viewer shows it: each XAML file read as XML, each element's, attribute's and value's part of it highlighted, its project as XML, its solution as one, and its C# as C#",
    async () => {
      const { assemblyPath } = await buildFixture("wpf");
      const server = await start();
      const base = server.url.slice(0, -1);

      const started = await startReconstruction(
        { path: assemblyPath },
        transport,
        base,
      );
      if (!started.ok) {
        throw new Error(started.message);
      }
      const { id } = started.started;
      const events = await follow(`${base}${started.started.events}`);
      expect(events.at(-1)).toMatchObject({
        type: "ended",
        data: { kind: "reconstructed", report: { outcome: "full" } },
      });
      const listed = await listRecoveredFiles(id, transport, base);
      if (!listed.ok) {
        throw new Error(listed.message);
      }
      expect(
        Object.fromEntries(
          listed.files.map(({ path }) => [
            path,
            isBinary(path) ? "binary" : languageOf(path),
          ]),
        ),
      ).toEqual({
        "Tally.sln": "sln",
        "Tally/Tally.csproj": "xml",
        "Tally/Properties/AssemblyInfo.cs": "csharp",
        "Tally/App.xaml.cs": "csharp",
        "Tally/MainWindow.xaml.cs": "csharp",
        "Tally/Controls/CountBadge.xaml.cs": "csharp",
        "Tally/Assets/tally.png": "binary",
        "Tally/Themes/Palette.xaml": "xml",
        "Tally/Controls/CountBadge.xaml": "xml",
        "Tally/MainWindow.xaml": "xml",
        "Tally/App.xaml": "xml",
        "xray-report.json": "plaintext",
      });
      const read = new Map<string, string>();
      for (const { path } of listed.files.filter(
        ({ path }) => !isBinary(path),
      )) {
        const file = await readRecoveredFile(
          id,
          path,
          transport,
          undefined,
          base,
        );
        if (!file.ok) {
          throw new Error(`${path}: ${file.message}`);
        }
        read.set(path, file.text);
      }

      // Monaco needs a page: happy-dom's, set up only once the files are
      // read, as it takes the place of Node.js's fetch and URL.
      const page = await builtinEnvironments["happy-dom"].setup(globalThis, {});
      try {
        const { highlight, highlightedXamlParts, ofType, xamlParts } =
          await import("@xray/web/test-highlight");
        for (const [path, text] of read) {
          if (!path.endsWith(".xaml")) {
            continue;
          }
          const parts = xamlParts(text);
          expect(parts.tags, path).toContain(
            path.endsWith("App.xaml")
              ? "Application"
              : path.endsWith("Palette.xaml")
                ? "ResourceDictionary"
                : path.endsWith("CountBadge.xaml")
                  ? "UserControl"
                  : "Window",
          );
          expect(await highlightedXamlParts(path, text), path).toEqual(parts);
        }
        const project = await highlight(
          "Tally/Tally.csproj",
          read.get("Tally/Tally.csproj") as string,
        );
        expect(ofType(project, "tag.xml")).toEqual(
          expect.arrayContaining(["Project", "UseWPF", "Page"]),
        );
        const solution = await highlight(
          "Tally.sln",
          read.get("Tally.sln") as string,
        );
        expect(ofType(solution, "keyword.sln")).toEqual(
          expect.arrayContaining(["Project", "EndProject", "Global"]),
        );
        expect(ofType(solution, "string.sln")).toContain('"Tally"');
        const window = await highlight(
          "Tally/MainWindow.xaml.cs",
          read.get("Tally/MainWindow.xaml.cs") as string,
        );
        expect(ofType(window, /^keyword\.\w+\.cs$/)).toEqual(
          expect.arrayContaining(["namespace", "partial", "class"]),
        );
        const report = await highlight(
          "xray-report.json",
          read.get("xray-report.json") as string,
        );
        expect(report.flat().filter(({ type }) => type !== "")).toEqual([]);
      } finally {
        await page.teardown(globalThis);
      }
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it("says why, as the server does, when there is no such Reconstruction", async () => {
    const server = await start();

    const connection = await new Promise<Connection>((resolve) => {
      followReconstruction(
        `${server.url}api/reconstructions/00000000-0000-0000-0000-000000000000/events`,
        {
          onEvent: () => undefined,
          onConnection: (each) => {
            if (each.state === "lost" || each.state === "ended") {
              resolve(each);
            }
          },
        },
        transport,
      );
    });

    expect(connection).toEqual({
      state: "lost",
      message:
        "There is no such Reconstruction: Xray has been restarted since it ran, or it never did. Reconstruct the Assembly again.",
    });
  });

  it(
    "uploads the arithmetic Fixture's build folder, keeping its structure, and reconstructs the Assembly it holds to a Full Reconstruction",
    async () => {
      const { outputDirectory, assemblyPath } =
        await buildFixture("arithmetic");
      const server = await start();
      const selection = await selectionOf(outputDirectory);
      const progress: UploadProgress[] = [];

      const uploaded = await uploadSelection(
        selection,
        transport,
        (each) => progress.push(each),
        server.url.slice(0, -1),
      );
      if (!uploaded.ok) {
        throw new Error(uploaded.message);
      }
      const folder = basename(outputDirectory);
      expect(uploaded.upload.assembly).toBe(
        `${folder}/${basename(assemblyPath)}`,
      );
      const total = selection.files.reduce(
        (sum, { file }) => sum + file.size,
        0,
      );
      expect(progress.at(-1)).toEqual({
        sent: total,
        total,
        arrived: selection.files.length,
        fileCount: selection.files.length,
      });
      // Every file, whole, where it was in the folder, in the Workspace only.
      const uploadFolder = join(
        server.workspace,
        "uploads",
        uploaded.upload.id,
      );
      for (const { path } of selection.files) {
        const original = join(outputDirectory, ...path.split("/").slice(1));
        expect(await readFile(join(uploadFolder, ...path.split("/")))).toEqual(
          await readFile(original),
        );
      }

      const started = await startReconstruction(
        {
          upload: uploaded.upload.id,
          assembly: uploaded.upload.assembly ?? "",
        },
        transport,
        server.url.slice(0, -1),
      );
      if (!started.ok) {
        throw new Error(started.message);
      }
      const events = await follow(
        `${server.url.slice(0, -1)}${started.started.events}`,
      );

      expect(events[0]).toEqual({
        type: "started",
        data: { path: join(uploadFolder, folder, basename(assemblyPath)) },
      });
      expect(events.at(-1)).toMatchObject({
        type: "ended",
        data: {
          kind: "reconstructed",
          directory: join(
            server.workspace,
            "reconstructions",
            started.started.id,
          ),
          report: { outcome: "full" },
        },
      });

      await server.close();
      expect(await exists(server.workspace)).toBe(false);
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "uploads the multi-assembly Fixture's build folder and reconstructs it with its Sibling Assemblies, each a project of its own, or, turned off, copying them into Dependencies instead",
    async () => {
      const { outputDirectory } = await buildFixture("multi-assembly");
      const server = await start();
      const base = server.url.slice(0, -1);
      const uploaded = await uploadSelection(
        await selectionOf(outputDirectory),
        transport,
        () => undefined,
        base,
      );
      if (!uploaded.ok) {
        throw new Error(uploaded.message);
      }
      const assembly = `${basename(outputDirectory)}/MultiAssembly.dll`;
      expect(uploaded.upload.assembly).toBe(assembly);

      const ends = [];
      for (const siblings of [true, false]) {
        const started = await startReconstruction(
          { upload: uploaded.upload.id, assembly, siblings },
          transport,
          base,
        );
        if (!started.ok) {
          throw new Error(started.message);
        }
        ends.push((await follow(`${base}${started.started.events}`)).at(-1));
      }

      expect(ends[0]).toMatchObject({
        type: "ended",
        data: {
          kind: "reconstructed",
          report: {
            outcome: "full",
            inputs: { options: { siblings: true } },
            siblingProblems: [],
            solution: {
              projects: [
                {
                  projectPath: "MultiAssembly/MultiAssembly.csproj",
                  projectReferences: [
                    "Inventory/Inventory.csproj",
                    "Pricing/Pricing.csproj",
                  ],
                },
                { projectPath: "Inventory/Inventory.csproj" },
                { projectPath: "Pricing/Pricing.csproj" },
              ],
            },
          },
        },
      });
      expect(ends[1]).toMatchObject({
        type: "ended",
        data: {
          kind: "reconstructed",
          report: {
            outcome: "full",
            inputs: { options: { siblings: false } },
            solution: {
              projects: [
                {
                  projectPath: "MultiAssembly/MultiAssembly.csproj",
                  projectReferences: [],
                  binaryReferences: [
                    "Dependencies/Inventory.dll",
                    "Dependencies/Pricing.dll",
                  ],
                },
              ],
            },
            // Still run, to look its references up as NuGet packages.
            timings: { resolveDependencies: expect.any(Number) as unknown },
          },
        },
      });
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it("uploads the native Fixture, a single file, and says why Xray cannot reconstruct it", async () => {
    const server = await start();
    const name = basename(NATIVE_EXECUTABLE_FIXTURE);

    const uploaded = await uploadSelection(
      {
        name,
        files: [
          { path: name, file: await openAsBlob(NATIVE_EXECUTABLE_FIXTURE) },
        ],
      },
      transport,
      () => undefined,
      server.url.slice(0, -1),
    );
    if (!uploaded.ok) {
      throw new Error(uploaded.message);
    }
    const started = await startReconstruction(
      { upload: uploaded.upload.id, assembly: name },
      transport,
      server.url.slice(0, -1),
    );
    if (!started.ok) {
      throw new Error(started.message);
    }
    const events = await follow(
      `${server.url.slice(0, -1)}${started.started.events}`,
    );

    expect(uploaded.upload.assembly).toBe(name);
    // Explained as xray inspect explains it, and with no summary to show.
    const cli = await inspectWithCli(NATIVE_EXECUTABLE_FIXTURE);
    expect(cli.code).toBe(3);
    expect(events.at(-1)).toEqual({
      type: "ended",
      data: {
        kind: "rejected",
        inputKind: "native-executable",
        explanation: cli.stderr.trimEnd(),
      },
    });
    expect(cli.stderr).toContain(
      `"${name}" is a Native Executable (x64 machine code), not a Managed Assembly, so Xray cannot reconstruct it.`,
    );
    expect(events.map((event) => event.type)).not.toContain("inspected");
  });
});

/**
 * The folder as a browser's folder picker gives it: every file in it, each
 * with its path from the folder's parent, read from disk only as it is sent.
 */
async function selectionOf(folder: string): Promise<Selection> {
  const name = basename(folder);
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = join(entry.parentPath, entry.name);
        return {
          path: [name, ...relative(folder, path).split(sep)].join("/"),
          file: await openAsBlob(path),
        };
      }),
  );
  return { name, files };
}

/** Every event of the Reconstruction whose stream is at `url`, once it has ended. */
function follow(url: string): Promise<WebAppEvent[]> {
  const events: WebAppEvent[] = [];
  return new Promise((resolve, reject) => {
    followReconstruction(
      url,
      {
        onEvent: (event) => events.push(event),
        onConnection: (connection) => {
          if (connection.state === "ended") {
            resolve(events);
          } else if (connection.state === "lost") {
            reject(new Error(connection.message));
          }
        },
      },
      transport,
    );
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
