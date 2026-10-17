import { describe, expect, it } from "vitest";

import {
  filePath,
  filesPath,
  listRecoveredFiles,
  readRecoveredFile,
  zipPath,
} from "./files-client.js";
import { UNREACHABLE } from "./reconstruction-client.js";
import { json, recording } from "./test-transport.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("filesPath and filePath", () => {
  it("say where a Recovered Solution's files are listed, and each is sent from, each name encoded", () => {
    expect(filesPath(ID)).toBe(`/api/reconstructions/${ID}/files`);
    expect(filePath(ID, "Arithmetic/Program.cs")).toBe(
      `/api/reconstructions/${ID}/files/Arithmetic/Program.cs`,
    );
    expect(filePath(ID, "App/Généric`1 #2 %.cs")).toBe(
      `/api/reconstructions/${ID}/files/App/G%C3%A9n%C3%A9ric%601%20%232%20%25.cs`,
    );
  });
});

describe("zipPath", () => {
  it("says where a Recovered Solution is downloaded from, as a zip archive", () => {
    expect(zipPath(ID)).toBe(`/api/reconstructions/${ID}/zip`);
    expect(zipPath("a/b c")).toBe("/api/reconstructions/a%2Fb%20c/zip");
  });
});

describe("listRecoveredFiles", () => {
  it("resolves the files the server lists", async () => {
    const files = [
      { path: "Arithmetic.sln", size: 1_024 },
      { path: "Arithmetic/Program.cs", size: 512 },
    ];
    const { transport, requests } = recording(async () => json(200, { files }));

    const result = await listRecoveredFiles(ID, transport);

    expect(result).toEqual({ ok: true, files });
    expect(requests.map((request) => request.url)).toEqual([filesPath(ID)]);
  });

  it("resolves why the server would not list them", async () => {
    const message =
      "The Reconstruction has not finished. Its files can be browsed, and downloaded, once it has.";
    const { transport } = recording(async () => json(409, { message }));

    expect(await listRecoveredFiles(ID, transport)).toEqual({
      ok: false,
      message,
    });
  });

  it("resolves that it cannot reach Xray", async () => {
    const { transport } = recording(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    expect(await listRecoveredFiles(ID, transport)).toEqual({
      ok: false,
      message: UNREACHABLE,
    });
  });
});

describe("readRecoveredFile", () => {
  it("resolves the file's text", async () => {
    const text = "namespace Arithmetic;\n";
    const { transport, requests } = recording(
      async () => new Response(text, { status: 200 }),
    );

    const result = await readRecoveredFile(
      ID,
      "Arithmetic/Program.cs",
      transport,
    );

    expect(result).toEqual({ ok: true, text });
    expect(requests.map((request) => request.url)).toEqual([
      filePath(ID, "Arithmetic/Program.cs"),
    ]);
  });

  it("resolves why the server would not send it", async () => {
    const message =
      'There is no file "App/Missing.cs" in the Recovered Solution.';
    const { transport } = recording(async () => json(404, { message }));

    expect(await readRecoveredFile(ID, "App/Missing.cs", transport)).toEqual({
      ok: false,
      message,
    });
  });

  it("stops reading once told to, rejecting rather than resolving", async () => {
    const reads = new AbortController();
    const { transport, requests } = recording(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );

    const reading = readRecoveredFile(
      ID,
      "App/Large.cs",
      transport,
      reads.signal,
    );
    reads.abort();

    await expect(reading).rejects.toThrow("Aborted");
    expect(requests[0]?.init?.signal).toBe(reads.signal);
  });

  it("resolves that it cannot reach Xray", async () => {
    const { transport } = recording(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    expect(await readRecoveredFile(ID, "App/Program.cs", transport)).toEqual({
      ok: false,
      message: UNREACHABLE,
    });
  });
});
