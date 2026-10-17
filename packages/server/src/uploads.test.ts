import { request } from "node:http";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Reconstruction, ReconstructOptions } from "@xray/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UPLOAD_LIST_LIMIT } from "./api.js";
import type { Reconstruct } from "./reconstructions.js";
import { SERVER_HOST, startServer, type XrayServer } from "./server.js";
import {
  openStream,
  send,
  sendRefusable,
  type JsonResponse,
} from "./test-client.js";
import { checkUploadFiles, UploadRefused, type UploadFile } from "./uploads.js";

// Uploading an Assembly, or a folder, into the Workspace, and reconstructing
// it from there, with Reconstructions this test does not run; the real ones
// are in web-client.engine.test.ts.

interface Run {
  readonly path: string;
  readonly options: ReconstructOptions;
}

let temporaryRoot: string;
let runs: Run[];
const servers: XrayServer[] = [];

const fakeReconstruct: Reconstruct = (path, _outputDirectory, options) =>
  new Promise<Reconstruction>((_resolve, reject) => {
    runs.push({ path, options });
    options.signal?.addEventListener("abort", () =>
      reject(options.signal?.reason),
    );
  });

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "xray-upload-test-"));
  for (const name of ["TMPDIR", "TMP", "TEMP"]) {
    vi.stubEnv(name, temporaryRoot);
  }
  runs = [];
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function start(): Promise<XrayServer> {
  const server = await startServer({ port: 0, reconstruct: fakeReconstruct });
  servers.push(server);
  return server;
}

/** A folder as the browser uploads it: each file's path from the folder's parent. */
const APP: Readonly<Record<string, Buffer>> = {
  "App/App.dll": Buffer.from("MZ the application's own Assembly"),
  "App/App.runtimeconfig.json": Buffer.from('{"runtimeOptions": {}}'),
  "App/libs/Library.dll": Buffer.from("MZ a library"),
  "App/empty.txt": Buffer.alloc(0),
};

function listOf(files: Readonly<Record<string, Buffer>>): UploadFile[] {
  return Object.entries(files).map(([path, contents]) => ({
    path,
    size: contents.length,
  }));
}

function begin(
  server: XrayServer,
  files: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  return send(
    server.port,
    "POST",
    "/api/uploads",
    JSON.stringify({ files }),
    headers,
  );
}

function put(
  server: XrayServer,
  location: string,
  contents: Buffer | string,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  return send(server.port, "PUT", location, contents, {
    "content-type": "application/octet-stream",
    ...headers,
  });
}

/** Uploads `files` whole, and resolves with what beginning the upload answered. */
async function upload(
  server: XrayServer,
  files: Readonly<Record<string, Buffer>>,
): Promise<{ id: string; files: string; assembly: string | null }> {
  const begun = await begin(server, listOf(files));
  expect(begun.status).toBe(201);
  const answer = begun.body as { id: string; files: string; assembly: null };
  for (const [index, contents] of Object.values(files).entries()) {
    const sent = await put(server, `${answer.files}/${index}`, contents);
    expect(sent.status).toBe(204);
  }
  return answer;
}

function reconstruct(
  server: XrayServer,
  body: Record<string, unknown>,
): Promise<JsonResponse> {
  return send(
    server.port,
    "POST",
    "/api/reconstructions",
    JSON.stringify(body),
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Every file below `folder`, relative to it with `/` between names. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .toSorted();
}

describe("checkUploadFiles", () => {
  it("takes a single file, or the files of a folder, each with its size", () => {
    expect(checkUploadFiles([{ path: "MyApp.exe", size: 4096 }])).toEqual([
      { path: "MyApp.exe", size: 4096 },
    ]);
    expect(checkUploadFiles(listOf(APP))).toEqual(listOf(APP));
    expect(
      checkUploadFiles([{ path: "Ünïcode Ápp/App (1).dll", size: 0 }]),
    ).toEqual([{ path: "Ünïcode Ápp/App (1).dll", size: 0 }]);
  });

  it.each([
    [undefined],
    ["App/App.dll"],
    [[{ path: "App/App.dll" }]],
    [[{ path: "App/App.dll", size: -1 }]],
    [[{ path: "App/App.dll", size: 1.5 }]],
    [[{ path: "App/App.dll", size: "10" }]],
    [[{ path: 7, size: 10 }]],
    [[null]],
  ])("refuses %j, saying what to send instead", (files) => {
    expect(checkUploadFiles(files)).toEqual(
      new UploadRefused(
        400,
        'Send the files to upload as JSON: {"files": [{"path": "…", "size": …}, …]}.',
      ),
    );
  });

  it("refuses to upload nothing", () => {
    expect(checkUploadFiles([])).toMatchObject({
      status: 400,
      message:
        "There are no files to upload: choose an Assembly, or a folder holding one.",
    });
  });

  it.each([
    "../App.dll",
    "App/../../App.dll",
    "App/./App.dll",
    "/etc/App.dll",
    "App//App.dll",
    "App/",
    "",
  ])(
    "refuses %j, which does not lead to a file inside the upload's folder",
    (path) => {
      expect(checkUploadFiles([{ path, size: 1 }])).toMatchObject({
        status: 400,
        message: `Xray cannot upload "${path}": its path must lead from the folder uploaded to a file in it, with / between names, none of them empty, . or ...`,
      });
    },
  );

  it.each([
    ["App\\..\\App.dll", "App\\..\\App.dll"],
    ["C:/App.dll", "C:"],
    ["App/App.dll:stream", "App.dll:stream"],
    ["App/what?.dll", "what?.dll"],
    ["App/line\nbreak.dll", "line\nbreak.dll"],
    ["App/nul\u0000.dll", "nul\u0000.dll"],
  ])(
    "refuses %j, whose names hold a character some system cannot",
    (path, segment) => {
      expect(checkUploadFiles([{ path, size: 1 }])).toMatchObject({
        status: 400,
        message: `Xray cannot upload "${path}": "${segment}" holds a character a name cannot hold on every system: \\ : * ? " < > | or a control character.`,
      });
    },
  );

  it.each([
    ["App/CON", "CON"],
    ["App/nul.dll", "nul.dll"],
    ["App/Com1.txt", "Com1.txt"],
    ["App/lpt9/App.dll", "lpt9"],
    ["App/trailing./App.dll", "trailing."],
    ["App/App.dll ", "App.dll "],
  ])("refuses %j, which Windows cannot hold", (path, segment) => {
    expect(checkUploadFiles([{ path, size: 1 }])).toMatchObject({
      status: 400,
      message: `Xray cannot upload "${path}": Windows cannot hold a file or folder named "${segment}".`,
    });
  });

  it("refuses two files that differ only in case, which would be one on Windows and macOS", () => {
    expect(
      checkUploadFiles([
        { path: "App/App.dll", size: 1 },
        { path: "app/APP.DLL", size: 1 },
      ]),
    ).toMatchObject({
      status: 400,
      message:
        '"App/App.dll" and "app/APP.DLL" would be the same file in Xray\'s Workspace, whose names do not tell capitals from small letters on every system.',
    });
  });

  it("refuses a file that is also a folder of another, in either order", () => {
    expect(
      checkUploadFiles([
        { path: "App/libs", size: 1 },
        { path: "App/libs/Library.dll", size: 1 },
      ]),
    ).toMatchObject({
      status: 400,
      message:
        '"App/libs" cannot be both a file and the folder holding "App/libs/Library.dll".',
    });
    expect(
      checkUploadFiles([
        { path: "App/libs/Library.dll", size: 1 },
        { path: "App/Libs", size: 1 },
      ]),
    ).toMatchObject({
      status: 400,
      message:
        '"App/libs" and "App/Libs" would be the same folder in Xray\'s Workspace, whose names do not tell capitals from small letters on every system.',
    });
  });

  it("refuses a folder holding no .exe or .dll, but not a single file, which classifying explains", () => {
    expect(
      checkUploadFiles([
        { path: "Docs/a.txt", size: 1 },
        { path: "Docs/b.txt", size: 1 },
      ]),
    ).toMatchObject({
      status: 400,
      message:
        "There is no .exe or .dll among the files given: choose an Assembly, or a folder holding one.",
    });
    expect(checkUploadFiles([{ path: "notes.txt", size: 1 }])).toEqual([
      { path: "notes.txt", size: 1 },
    ]);
  });
});

describe("POST /api/uploads", () => {
  it("begins an upload, saying where to send each file and which Assembly it will reconstruct, before any arrives", async () => {
    const server = await start();

    const response = await begin(server, listOf(APP));

    expect(response.status).toBe(201);
    const { id, files, assemblies, assembly } = response.body as Record<
      string,
      unknown
    >;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(files).toBe(`/api/uploads/${String(id)}/files`);
    expect(response.headers.location).toBe(files);
    expect(assemblies).toEqual(["App/App.dll", "App/libs/Library.dll"]);
    expect(assembly).toBe("App/App.dll");
    expect(await exists(join(server.workspace, "uploads"))).toBe(false);
  });

  it("says when the files do not say which Assembly to reconstruct, listing them to choose from", async () => {
    const server = await start();

    const response = await begin(server, [
      { path: "Libs/One.dll", size: 1 },
      { path: "Libs/Two.dll", size: 1 },
    ]);

    expect(response.body).toMatchObject({
      assemblies: ["Libs/One.dll", "Libs/Two.dll"],
      assembly: null,
    });
  });

  it("refuses files it cannot upload, saying why, and keeps nothing of them", async () => {
    const server = await start();

    const response = await begin(server, [{ path: "../App.dll", size: 1 }]);

    expect(response.status).toBe(400);
    expect((response.body as { message: string }).message).toMatch(
      /^Xray cannot upload "\.\.\/App\.dll": /,
    );
    expect(await readdir(server.workspace)).toEqual([]);
  });

  it("refuses a list that is not JSON", async () => {
    const server = await start();

    const response = await send(
      server.port,
      "POST",
      "/api/uploads",
      "App.dll",
      { "content-type": "text/plain" },
    );

    expect(response).toMatchObject({
      status: 415,
      body: {
        message:
          'Send the files to upload as JSON: {"files": [{"path": "…", "size": …}, …]}.',
      },
    });
  });

  it("takes a list of tens of thousands of files", async () => {
    const server = await start();
    const files = Array.from({ length: 30_000 }, (_, index) => ({
      path: `Big/Folder ${index % 100}/Assembly${index}.dll`,
      size: 123_456,
    }));

    const response = await begin(server, files);

    expect(response.status).toBe(201);
    expect((response.body as { assemblies: string[] }).assemblies).toHaveLength(
      30_000,
    );
  });
});

describe("POST /api/uploads, of a list over its limit", () => {
  it("refuses it as too large", async () => {
    const server = await start();
    const files = Array.from({ length: 200_000 }, (_, index) => ({
      path: `Huge/${"Folder/".repeat(10)}Assembly${index}.dll`,
      size: 1,
    }));
    const body = JSON.stringify({ files });
    expect(body.length).toBeGreaterThan(UPLOAD_LIST_LIMIT);

    const response = await sendRefusable(
      server.port,
      "POST",
      "/api/uploads",
      body,
    );

    expect(response.status).toBe(413);
    expect(await readdir(server.workspace)).toEqual([]);
  });
});

describe("PUT /api/uploads/<id>/files/<n>", () => {
  it("writes each file into a folder of the upload's own in the Workspace, under the path it was given", async () => {
    const server = await start();

    const { id } = await upload(server, APP);

    const folder = join(server.workspace, "uploads", id);
    expect(await filesIn(folder)).toEqual(Object.keys(APP).toSorted());
    for (const [path, contents] of Object.entries(APP)) {
      expect(await readFile(join(folder, ...path.split("/")))).toEqual(
        contents,
      );
    }
  });

  it("streams a file far larger than any request body the server reads whole", async () => {
    const server = await start();
    const large = Buffer.alloc(24 * 1024 * 1024, 0x5a);

    const { id } = await upload(server, { "Large.dll": large });

    expect(
      (await stat(join(server.workspace, "uploads", id, "Large.dll"))).size,
    ).toBe(large.length);
  });

  it("refuses a file that is not the size declared, keeping nothing of it, so it can be sent again", async () => {
    const server = await start();
    const begun = (await begin(server, listOf(APP))).body as {
      id: string;
      files: string;
    };
    const target = join(
      server.workspace,
      "uploads",
      begun.id,
      "App",
      "App.dll",
    );
    const size = (APP["App/App.dll"] as Buffer).length;

    const longer = await put(
      server,
      `${begun.files}/0`,
      Buffer.alloc(size + 10),
      { "transfer-encoding": "chunked" },
    );
    const shorter = await put(
      server,
      `${begun.files}/0`,
      Buffer.alloc(size - 1),
      { "transfer-encoding": "chunked" },
    );
    const declaredShorter = await put(
      server,
      `${begun.files}/0`,
      Buffer.alloc(size - 1),
    );

    expect(longer).toMatchObject({
      status: 400,
      body: {
        message: `"App/App.dll" is ${size} bytes, but ${size + 10} were sent.`,
      },
    });
    expect(shorter).toMatchObject({
      status: 400,
      body: {
        message: `"App/App.dll" is ${size} bytes, but ${size - 1} were sent.`,
      },
    });
    expect(declaredShorter).toMatchObject({
      status: 400,
      body: {
        message: `"App/App.dll" is ${size} bytes, but ${size - 1} were sent.`,
      },
    });
    expect(await exists(target)).toBe(false);
    expect(
      (await put(server, `${begun.files}/0`, APP["App/App.dll"] as Buffer))
        .status,
    ).toBe(204);
    expect(await readFile(target)).toEqual(APP["App/App.dll"]);
  });

  it("refuses a file that has arrived already", async () => {
    const server = await start();
    const { files } = await upload(server, APP);

    const again = await put(server, `${files}/0`, APP["App/App.dll"] as Buffer);

    expect(again).toMatchObject({
      status: 409,
      body: { message: '"App/App.dll" has already been uploaded.' },
    });
  });

  it("deletes what arrived of a file whose sending was cut off, so it can be sent again", async () => {
    const server = await start();
    const begun = (await begin(server, [{ path: "App.dll", size: 1_000_000 }]))
      .body as { id: string; files: string };
    const target = join(server.workspace, "uploads", begun.id, "App.dll");

    const sent = request({
      host: SERVER_HOST,
      port: server.port,
      method: "PUT",
      path: `${begun.files}/0`,
      headers: {
        host: `${SERVER_HOST}:${server.port}`,
        "content-type": "application/octet-stream",
        "content-length": "1000000",
      },
    });
    sent.on("error", () => undefined);
    sent.write(Buffer.alloc(300_000));
    await vi.waitFor(async () => expect(await exists(target)).toBe(true));
    sent.destroy();

    await vi.waitFor(async () => expect(await exists(target)).toBe(false));
    expect(
      (await put(server, `${begun.files}/0`, Buffer.alloc(1_000_000))).status,
    ).toBe(204);
  });

  it.each([
    [
      "no such upload",
      "/api/uploads/00000000-0000-0000-0000-000000000000/files/0",
      "There is no such upload: Xray has been restarted since it began, or it never did. Upload the Assembly again.",
    ],
    ["no such file", "/files/4", "There is no such file in this upload."],
    [
      "a file not by its number",
      "/files/App.dll",
      "There is no such file in this upload.",
    ],
  ])("says there is %s", async (_case, location, message) => {
    const server = await start();
    const { files } = (await begin(server, listOf(APP))).body as {
      files: string;
    };

    const response = await put(
      server,
      location.startsWith("/files") ? files + location.slice(6) : location,
      "MZ",
    );

    expect(response).toMatchObject({ status: 404, body: { message } });
  });

  it("refuses contents not sent as application/octet-stream", async () => {
    const server = await start();
    const { files } = (await begin(server, listOf(APP))).body as {
      files: string;
    };

    const response = await put(server, `${files}/0`, "MZ", {
      "content-type": "text/plain",
    });

    expect(response).toMatchObject({
      status: 415,
      body: {
        message: "Send the file's contents as application/octet-stream.",
      },
    });
  });
});

describe("POST /api/reconstructions, of an upload", () => {
  it("reconstructs the Assembly chosen, where it was uploaded to in the Workspace", async () => {
    const server = await start();
    const { id } = await upload(server, APP);

    const response = await reconstruct(server, {
      upload: id,
      assembly: "App/libs/Library.dll",
    });

    const uploaded = join(
      server.workspace,
      "uploads",
      id,
      "App",
      "libs",
      "Library.dll",
    );
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ path: uploaded });
    expect(runs.map((run) => run.path)).toEqual([uploaded]);
    const stream = await openStream(
      server.port,
      (response.body as { events: string }).events,
    );
    await stream.next(1);
    stream.drop();
    expect(stream.events[0]).toEqual({
      id: "0",
      type: "started",
      data: { path: uploaded },
    });
  });

  it("refuses to reconstruct an upload before all its files have arrived", async () => {
    const server = await start();
    const { id, files } = (await begin(server, listOf(APP))).body as {
      id: string;
      files: string;
    };
    await put(server, `${files}/0`, APP["App/App.dll"] as Buffer);

    const response = await reconstruct(server, {
      upload: id,
      assembly: "App/App.dll",
    });

    expect(response).toMatchObject({
      status: 409,
      body: {
        message:
          "The upload has not finished: 1 of its 4 files have arrived. Reconstruct it once they all have.",
      },
    });
    expect(runs).toEqual([]);
  });

  it.each([
    [
      { upload: "00000000-0000-0000-0000-000000000000", assembly: "App.dll" },
      404,
      "There is no such upload: Xray has been restarted since it began, or it never did. Upload the Assembly again.",
    ],
    [
      { assembly: "App/Other.dll" },
      400,
      '"App/Other.dll" is not one of the files uploaded.',
    ],
    [
      { assembly: "App/../App/App.dll" },
      400,
      '"App/../App/App.dll" is not one of the files uploaded.',
    ],
    [
      { assembly: 1 },
      400,
      'Send the upload, and the Assembly in it to reconstruct, as JSON: {"upload": "…", "assembly": "…"}.',
    ],
  ])("refuses %j, saying why", async (body, status, message) => {
    const server = await start();
    const { id } = await upload(server, APP);

    const response = await reconstruct(server, { upload: id, ...body });

    expect(response).toMatchObject({ status, body: { message } });
    expect(runs).toEqual([]);
  });
});

describe("uploads, from a page another host served", () => {
  it("are refused, so no other site can write to the Workspace", async () => {
    const server = await start();
    const { files } = (await begin(server, listOf(APP))).body as {
      files: string;
    };
    const origin = { origin: "http://evil.example" };
    const refused = {
      status: 403,
      body: {
        message: `Xray only answers pages it served itself, at ${server.url}.`,
      },
    };

    expect(await begin(server, listOf(APP), origin)).toMatchObject(refused);
    expect(
      await put(server, `${files}/0`, APP["App/App.dll"] as Buffer, origin),
    ).toMatchObject(refused);
    expect(await filesIn(server.workspace)).toEqual([]);
  });
});

describe("stopping the server", () => {
  it("deletes every upload with the Workspace, waiting for a file still arriving to stop", async () => {
    const server = await start();
    await upload(server, APP);
    const begun = (await begin(server, [{ path: "Slow.dll", size: 1_000_000 }]))
      .body as { id: string; files: string };
    const sent = request({
      host: SERVER_HOST,
      port: server.port,
      method: "PUT",
      path: `${begun.files}/0`,
      headers: {
        host: `${SERVER_HOST}:${server.port}`,
        "content-type": "application/octet-stream",
        "content-length": "1000000",
      },
    });
    sent.on("error", () => undefined);
    sent.write(Buffer.alloc(300_000));
    await vi.waitFor(async () =>
      expect(
        await exists(join(server.workspace, "uploads", begun.id, "Slow.dll")),
      ).toBe(true),
    );

    await server.close();

    expect(await exists(server.workspace)).toBe(false);
    expect(await readdir(temporaryRoot)).toEqual([]);
  });
});
