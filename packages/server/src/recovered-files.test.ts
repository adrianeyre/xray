import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  AssemblySummary,
  Reconstruction,
  ReconstructOptions,
} from "@xray/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachment, type RecoveredFiles } from "./api.js";
import type { Reconstruct } from "./reconstructions.js";
import { SERVER_HOST, startServer, type XrayServer } from "./server.js";
import {
  get,
  openStream,
  startReconstruction,
  type EventStream,
} from "./test-client.js";
import { extractZip, readZip } from "./test-zip.js";

// The server listing and sending the files of a Recovered Solution, written
// by Reconstructions this test drives by hand; the arithmetic Fixture's real
// one is in web-client.engine.test.ts.

/** A Reconstruction the server started, run by the test. */
interface FakeRun {
  readonly outputDirectory: string;
  readonly options: ReconstructOptions;
  /** Writes `files` as its Recovered Solution, listing those in `listed`, and ends with it. */
  readonly write: (
    files: Readonly<Record<string, string | Buffer>>,
    listed?: readonly string[],
  ) => Promise<void>;
  readonly finish: (reconstruction: Reconstruction) => void;
  readonly fail: (error: unknown) => void;
}

let temporaryRoot: string;
let runs: FakeRun[];
const servers: XrayServer[] = [];
const streams: EventStream[] = [];

const summary: AssemblySummary = {
  path: "/apps/App.dll",
  assembly: {
    name: "App",
    version: "1.0.0.0",
    culture: null,
    publicKeyToken: null,
  },
  targetFramework: {
    moniker: "net8.0",
    frameworkName: ".NETCoreApp,Version=v8.0",
    runtimeVersion: "v4.0.30319",
    inferredFrom: null,
    support: "full",
  },
  architecture: {
    platformTarget: "AnyCPU",
    prefer32Bit: false,
    bitness: "any",
    machine: "I386",
  },
  entryPoint: { type: "App.Program", method: "Main" },
  outputKind: "console",
  references: [],
  counts: { types: 1, methods: 1, resources: 0 },
  pdb: { status: "none" },
  obfuscation: { status: "clean", indicators: [] },
};

const fakeReconstruct: Reconstruct = (path, outputDirectory, options) =>
  new Promise((resolve, reject) => {
    runs.push({
      outputDirectory,
      options,
      write: async (files, listed = Object.keys(files)) => {
        for (const [file, contents] of Object.entries(files)) {
          const target = join(outputDirectory, ...file.split("/"));
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, contents);
        }
        resolve({
          accepted: true,
          classification: {
            path,
            kind: "managed-assembly",
            accepted: true,
            explanation: '"App.dll" is a Managed Assembly.',
          },
          summary,
          solution: {
            directory: outputDirectory,
            solutionPath: "App.sln",
            projectPath: "App/App.csproj",
            targetFramework: "net8.0",
            outputType: "Exe",
            reportPath: "xray-report.json",
            files: listed,
            typeCount: 1,
            sourceFileCount: 1,
            projects: [
              {
                assemblyPath: path,
                assemblyName: "App",
                projectPath: "App/App.csproj",
                targetFramework: "net8.0",
                outputType: "Exe",
                typeCount: 1,
                sourceFileCount: 1,
                pdb: { status: "none" },
                obfuscation: { status: "clean", indicators: [] },
                projectReferences: [],
                packageReferences: [],
                binaryReferences: [],
                resources: [],
              },
            ],
          },
          build: null,
          run: null,
          outcome: "unverified",
          reasons: [],
          siblings: true,
          siblingProblems: [],
          offline: false,
          packages: [],
          dependencies: [],
          warnings: [],
          timings: {
            analyse: 1,
            decompile: 1,
            resolveDependencies: 1,
            generate: 1,
            build: null,
            run: null,
            total: 3,
          },
        });
      },
      finish: resolve,
      fail: reject,
    });
  });

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "xray-server-test-"));
  for (const name of ["TMPDIR", "TMP", "TEMP"]) {
    vi.stubEnv(name, temporaryRoot);
  }
  runs = [];
});

afterEach(async () => {
  for (const stream of streams.splice(0)) {
    stream.drop();
  }
  for (const run of runs) {
    run.fail(new Error("The test is over."));
  }
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

const ASSEMBLY =
  process.platform === "win32" ? "C:\\Apps\\App.dll" : "/apps/App.dll";

const PROGRAM = `namespace App;

internal static class Program
{
    private static int Main() => 0;
}
`;

/** The Recovered Solution most tests write: as @xray/core writes one, report last. */
const SOLUTION: Readonly<Record<string, string>> = {
  "App.sln": "Microsoft Visual Studio Solution File, Format Version 12.00\n",
  "App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n',
  "App/Properties/AssemblyInfo.cs":
    '[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]\n',
  "App/Program.cs": PROGRAM,
  "xray-report.json": '{"schemaVersion":1}\n',
};

/**
 * Starts a server, and a Reconstruction on it that writes `files` (listing
 * `listed`) as its Recovered Solution, and resolves once it has ended.
 */
async function reconstructed(
  files: Readonly<Record<string, string | Buffer>> = SOLUTION,
  listed?: readonly string[],
): Promise<{ server: XrayServer; id: string; directory: string }> {
  const server = await startServer({ port: 0, reconstruct: fakeReconstruct });
  servers.push(server);
  const response = await startReconstruction(server.port, ASSEMBLY);
  expect(response.status).toBe(202);
  const { id, events } = response.body as { id: string; events: string };
  const stream = await openStream(server.port, events);
  streams.push(stream);
  const run = runs.at(-1) as FakeRun;
  await run.write(files, listed);
  await stream.ended;
  return { server, id, directory: run.outputDirectory };
}

function filesOf(id: string): string {
  return `/api/reconstructions/${id}/files`;
}

/** Where the file at `path` is sent from: each name encoded, as the web app sends it. */
function fileOf(id: string, path: string): string {
  return `${filesOf(id)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function zipOf(id: string): string {
  return `/api/reconstructions/${id}/zip`;
}

function json(body: Buffer): unknown {
  return JSON.parse(body.toString("utf8"));
}

describe("GET /api/reconstructions/<id>/files", () => {
  it("lists every file of the Recovered Solution, with its size, in the order it was written, and nothing dotnet build made beside them", async () => {
    const { server, id } = await reconstructed(
      {
        ...SOLUTION,
        "App/bin/Debug/net8.0/App.dll": Buffer.alloc(64),
        "App/obj/project.assets.json": "{}",
      },
      Object.keys(SOLUTION),
    );

    const response = await get(server.port, filesOf(id));

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(json(response.body)).toEqual({
      files: Object.entries(SOLUTION).map(([path, contents]) => ({
        path,
        size: Buffer.byteLength(contents),
      })),
    } satisfies RecoveredFiles);
  });

  it("says there is nothing to browse yet while the Reconstruction runs", async () => {
    const server = await startServer({ port: 0, reconstruct: fakeReconstruct });
    servers.push(server);
    const response = await startReconstruction(server.port, ASSEMBLY);
    const { id } = response.body as { id: string };

    const listed = await get(server.port, filesOf(id));
    const sent = await get(server.port, fileOf(id, "App/Program.cs"));
    const zipped = await get(server.port, zipOf(id));

    for (const each of [listed, sent, zipped]) {
      expect(each.status).toBe(409);
      expect(json(each.body)).toEqual({
        message:
          "The Reconstruction has not finished. Its files can be browsed, and downloaded, once it has.",
      });
    }
  });

  it("says there is nothing to browse when the Reconstruction wrote no Recovered Solution", async () => {
    const server = await startServer({ port: 0, reconstruct: fakeReconstruct });
    servers.push(server);
    const response = await startReconstruction(server.port, ASSEMBLY);
    const { id, events } = response.body as { id: string; events: string };
    const stream = await openStream(server.port, events);
    streams.push(stream);
    runs[0]?.finish({
      accepted: false,
      classification: {
        path: ASSEMBLY,
        kind: "native-executable",
        accepted: false,
        explanation:
          "App.dll is a Native Executable (x64), not a Managed Assembly.",
      },
    });
    await stream.ended;

    for (const path of [filesOf(id), zipOf(id)]) {
      const response = await get(server.port, path);

      expect(response.status, path).toBe(404);
      expect(json(response.body), path).toEqual({
        message:
          "The Reconstruction wrote no Recovered Solution, so there are no files to browse or download.",
      });
    }
  });

  it("says there is no such Reconstruction, for one this session did not start", async () => {
    const { server } = await reconstructed();
    const id = "00000000-0000-0000-0000-000000000000";

    for (const path of [filesOf(id), fileOf(id, "App/Program.cs"), zipOf(id)]) {
      const response = await get(server.port, path);
      expect(response.status).toBe(404);
      expect(json(response.body)).toEqual({
        message:
          "There is no such Reconstruction: Xray has been restarted since it ran, or it never did. Reconstruct the Assembly again.",
      });
    }
  });
});

describe("GET /api/reconstructions/<id>/files/<path>", () => {
  it("sends each file of the Recovered Solution exactly as it was written, as text no page can run", async () => {
    const { server, id } = await reconstructed();

    for (const [path, contents] of Object.entries(SOLUTION)) {
      const response = await get(server.port, fileOf(id, path));

      expect(response.status, path).toBe(200);
      expect(response.body.toString("utf8"), path).toBe(contents);
      expect(response.headers["content-type"]).toBe(
        "text/plain; charset=utf-8",
      );
      expect(response.headers["content-length"]).toBe(
        String(Buffer.byteLength(contents)),
      );
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("sends files whose names must be encoded, however deep they are", async () => {
    const deep = `${"Very.Long.Namespace.Name/".repeat(12)}Deep.cs`;
    const files = {
      "App/Généric`1.cs": "class Généric<T> { }\n",
      "App/With Space #1 %20.cs": "class WithSpace { }\n",
      [deep]: "class Deep { }\n",
    };
    const { server, id } = await reconstructed(files);

    for (const [path, contents] of Object.entries(files)) {
      const response = await get(server.port, fileOf(id, path));

      expect(response.status, path).toBe(200);
      expect(response.body.toString("utf8"), path).toBe(contents);
    }
    expect(deep.length).toBeGreaterThan(200);
  });

  it("sends a large file whole", async () => {
    // A C# file of 32 MiB, far larger than any type decompiles to.
    const line =
      "    public static int Add(int a, int b) => a + b; // padding\n";
    const large = line.repeat(Math.ceil((32 * 1024 * 1024) / line.length));
    const { server, id } = await reconstructed({ "App/Large.cs": large });

    const response = await get(server.port, fileOf(id, "App/Large.cs"));

    expect(response.status).toBe(200);
    expect(response.headers["content-length"]).toBe(String(large.length));
    expect(response.body.equals(Buffer.from(large))).toBe(true);
  });

  it("sends no file outside the Recovered Solution, whatever path it is asked for", async () => {
    const { server, id, directory } = await reconstructed(
      {
        ...SOLUTION,
        "App/bin/Debug/net8.0/App.dll": "not of the Recovered Solution",
      },
      Object.keys(SOLUTION),
    );
    const secret = "SECRET: not for any page to read";
    // One elsewhere in the Workspace, one outside it, and one beside the
    // Recovered Solution's folder.
    const inWorkspace = join(server.workspace, "uploads", "secret.txt");
    const outside = join(temporaryRoot, "secret.txt");
    const beside = join(dirname(directory), "secret.txt");
    for (const path of [inWorkspace, outside, beside]) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, secret);
    }
    const base = filesOf(id);
    const attempts = [
      // Up and out, as given, encoded, and half-encoded.
      `${base}/../secret.txt`,
      `${base}/../../secret.txt`,
      `${base}/../../uploads/secret.txt`,
      `${base}/../../../secret.txt`,
      `${base}/App/../../secret.txt`,
      `${base}/..%2Fsecret.txt`,
      `${base}/..%2F..%2Fuploads%2Fsecret.txt`,
      `${base}/%2e%2e/%2e%2e/%2e%2e/secret.txt`,
      `${base}/%2E%2E%2F%2E%2E%2F%2E%2E%2Fsecret.txt`,
      `${base}/App%2F..%2F..%2Fsecret.txt`,
      `${base}/%252e%252e%252f%252e%252e%252fsecret.txt`,
      // Windows' separator.
      `${base}/..\\..\\secret.txt`,
      `${base}/..%5C..%5C..%5Csecret.txt`,
      // Absolute paths.
      `${base}/${outside}`,
      `${base}/${encodeURIComponent(outside)}`,
      `${base}/${encodeURIComponent(inWorkspace)}`,
      `${base}/file:${encodeURIComponent(outside)}`,
      // A file in the folder, but not one the Reconstruction wrote.
      `${base}/App/bin/Debug/net8.0/App.dll`,
      // A listed file's name, cut short by a NUL.
      `${base}/App.sln%00/../../secret.txt`,
      // The folder itself, and its folders.
      `${base}/`,
      `${base}/.`,
      `${base}/App`,
      `${base}/App/`,
      `${base}/./App/Program.cs`,
      `${base}//App/Program.cs`,
      // The Workspace, by another Reconstruction's id.
      `/api/reconstructions/..%2F..%2Fuploads/files/secret.txt`,
      `/api/reconstructions/../uploads/files/secret.txt`,
    ];

    for (const attempt of attempts) {
      const response = await get(server.port, attempt);

      expect(response.status, attempt).not.toBe(200);
      expect([400, 403, 404], attempt).toContain(response.status);
      expect(response.body.toString("utf8"), attempt).not.toContain("SECRET");
      expect(response.body.toString("utf8"), attempt).not.toContain(
        "not of the Recovered Solution",
      );
    }
  });

  it("sends no file a link in the Recovered Solution leads to outside its folder, and lists none", async ({
    skip,
  }) => {
    const { server, id, directory } = await reconstructed();
    const outside = join(temporaryRoot, "secret.txt");
    await writeFile(outside, "SECRET: not for any page to read");
    const program = join(directory, "App", "Program.cs");
    await rm(program);
    try {
      await symlink(outside, program);
    } catch (error) {
      // Windows lets only some users make links.
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
      }
      throw error;
    }

    const sent = await get(server.port, fileOf(id, "App/Program.cs"));
    const listed = await get(server.port, filesOf(id));

    expect(sent.status).toBe(404);
    expect(sent.body.toString("utf8")).not.toContain("SECRET");
    expect(
      (json(listed.body) as RecoveredFiles).files.map((file) => file.path),
    ).toEqual(
      Object.keys(SOLUTION).filter((path) => path !== "App/Program.cs"),
    );
  });

  it("says there is no such file, for a path that is none of the Recovered Solution's", async () => {
    const { server, id } = await reconstructed();

    const response = await get(server.port, fileOf(id, "App/Missing.cs"));

    expect(response.status).toBe(404);
    expect(json(response.body)).toEqual({
      message: 'There is no file "App/Missing.cs" in the Recovered Solution.',
    });
  });

  it("answers only requests addressed to it, as it does every other", async () => {
    const { server, id } = await reconstructed();

    const response = await new Promise<number>((resolve, reject) => {
      const sent = request(
        {
          host: SERVER_HOST,
          port: server.port,
          path: fileOf(id, "App/Program.cs"),
          // A page on another host whose name resolves to 127.0.0.1.
          headers: { host: `attacker.example:${server.port}` },
        },
        (answer) => {
          answer.resume();
          resolve(answer.statusCode ?? 0);
        },
      );
      sent.on("error", reject);
      sent.end();
    });

    expect(response).toBe(403);
  });
});

describe("GET /api/reconstructions/<id>/zip", () => {
  it("sends every file of the Recovered Solution, in the order it was written, in a folder named after its solution, as a zip archive to save", async () => {
    const { server, id } = await reconstructed();

    const response = await get(server.port, zipOf(id));

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="App.zip"; filename*=UTF-8''App.zip`,
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      readZip(response.body).map(({ name, contents }) => [
        name,
        contents.toString("utf8"),
      ]),
    ).toEqual(
      Object.entries(SOLUTION).map(([path, contents]) => [
        `App/${path}`,
        contents,
      ]),
    );
  });

  it("leaves out what dotnet build made beside the Recovered Solution, in bin/ and obj/", async () => {
    const { server, id } = await reconstructed(
      {
        ...SOLUTION,
        "App/bin/Debug/net8.0/App.dll": Buffer.alloc(64),
        "App/obj/project.assets.json": "{}",
        "App/obj/Debug/net8.0/App.AssemblyInfo.cs": "// made by dotnet build\n",
      },
      Object.keys(SOLUTION),
    );

    const response = await get(server.port, zipOf(id));

    const names = readZip(response.body).map((file) => file.name);
    expect(names).toEqual(Object.keys(SOLUTION).map((path) => `App/${path}`));
    expect(names.some((name) => /\/(bin|obj)\//.test(name))).toBe(false);
  });

  it("extracts, with the system's own tool, to one folder holding the Recovered Solution as it was written", async () => {
    const files = { ...SOLUTION, "App/Généric`1.cs": "class Généric<T> { }\n" };
    const { server, id } = await reconstructed(files);
    const response = await get(server.port, zipOf(id));
    const zip = join(temporaryRoot, "App.zip");
    await writeFile(zip, response.body);
    const into = join(temporaryRoot, "extracted");
    await mkdir(into);

    await extractZip(zip, into);

    expect(await readdir(into)).toEqual(["App"]);
    for (const [path, contents] of Object.entries(files)) {
      expect(
        await readFile(join(into, "App", ...path.split("/")), "utf8"),
        path,
      ).toBe(contents);
    }
  });

  it("names the archive in a way every browser reads, however its name must be encoded", () => {
    expect(attachment("Généric (1).zip")).toBe(
      `attachment; filename="G_n_ric (1).zip"; filename*=UTF-8''G%C3%A9n%C3%A9ric%20%281%29.zip`,
    );
    expect(attachment('A"B\\C.zip')).toBe(
      `attachment; filename="A_B_C.zip"; filename*=UTF-8''A%22B%5CC.zip`,
    );
  });

  it("zips a large file whole", async () => {
    // A C# file of 32 MiB, far larger than any type decompiles to.
    const line =
      "    public static int Add(int a, int b) => a + b; // padding\n";
    const large = line.repeat(Math.ceil((32 * 1024 * 1024) / line.length));
    const { server, id } = await reconstructed({ "App/Large.cs": large });

    const response = await get(server.port, zipOf(id));

    expect(response.status).toBe(200);
    expect(response.body.length).toBeLessThan(large.length / 20);
    expect(readZip(response.body)[0]?.contents.equals(Buffer.from(large))).toBe(
      true,
    );
  });

  it("zips no file a link in the Recovered Solution leads to outside its folder", async ({
    skip,
  }) => {
    const { server, id, directory } = await reconstructed();
    const outside = join(temporaryRoot, "secret.txt");
    await writeFile(outside, "SECRET: not for any page to read");
    const program = join(directory, "App", "Program.cs");
    await rm(program);
    try {
      await symlink(outside, program);
    } catch (error) {
      // Windows lets only some users make links.
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
      }
      throw error;
    }

    const response = await get(server.port, zipOf(id));

    const zipped = readZip(response.body);
    expect(zipped.map((file) => file.name)).toEqual(
      Object.keys(SOLUTION)
        .filter((path) => path !== "App/Program.cs")
        .map((path) => `App/${path}`),
    );
    expect(
      zipped.some((file) => file.contents.toString("utf8").includes("SECRET")),
    ).toBe(false);
  });

  it("zips only the files the Reconstruction listed, whatever their names lead to", async () => {
    const secret = join(temporaryRoot, "secret.txt");
    await writeFile(secret, "SECRET: not for any page to read");
    // A listing as no Reconstruction writes one, naming files outside its folder.
    const { server, id } = await reconstructed(SOLUTION, [
      ...Object.keys(SOLUTION),
      "../../../secret.txt",
      "../../uploads/secret.txt",
      secret,
    ]);

    const response = await get(server.port, zipOf(id));

    const zipped = readZip(response.body);
    expect(zipped.map((file) => file.name)).toEqual(
      Object.keys(SOLUTION).map((path) => `App/${path}`),
    );
  });
});
