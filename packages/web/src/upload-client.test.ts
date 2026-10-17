import { describe, expect, it } from "vitest";

import type { Answer, Transport } from "./reconstruction-client.js";
import { startReconstruction } from "./reconstruction-client.js";
import { json, recording } from "./test-transport.js";
import {
  formatBytes,
  PARALLEL_FILES,
  uploadSelection,
  type Selection,
  type UploadProgress,
} from "./upload-client.js";

const UPLOAD = {
  id: "5d0c1f9e-3c1e-4c55-9d6b-9f0e4c2b7a10",
  files: "/api/uploads/5d0c1f9e-3c1e-4c55-9d6b-9f0e4c2b7a10/files",
  assemblies: ["App/App.dll", "App/libs/Library.dll"],
  assembly: "App/App.dll",
};

const FOLDER: Selection = {
  name: "App",
  files: [
    { path: "App/App.dll", file: new Blob(["MZ" + "a".repeat(98)]) },
    { path: "App/App.runtimeconfig.json", file: new Blob(["{}"]) },
    { path: "App/libs/Library.dll", file: new Blob(["MZ" + "b".repeat(48)]) },
  ],
};

describe("uploadSelection", () => {
  it("says which files it will send, then sends each to its place, and resolves the upload", async () => {
    const { transport, requests, puts } = recording(async () =>
      json(201, UPLOAD),
    );

    const result = await uploadSelection(FOLDER, transport, () => undefined);

    expect(result).toEqual({ ok: true, upload: UPLOAD });
    expect(requests).toEqual([
      {
        url: "/api/uploads",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            files: [
              { path: "App/App.dll", size: 100 },
              { path: "App/App.runtimeconfig.json", size: 2 },
              { path: "App/libs/Library.dll", size: 50 },
            ],
          }),
        },
      },
    ]);
    expect(puts.map(({ url }) => url).toSorted()).toEqual([
      `${UPLOAD.files}/0`,
      `${UPLOAD.files}/1`,
      `${UPLOAD.files}/2`,
    ]);
    for (const [index, { url, body }] of puts.entries()) {
      expect(body).toBe(FOLDER.files[Number(url.split("/").at(-1))]?.file);
      expect(index).toBeLessThan(3);
    }
  });

  it("tells how far it has got, in bytes and files, as each file is sent", async () => {
    const pending: {
      onProgress: (sent: number) => void;
      resolve: (answer: Answer) => void;
    }[] = [];
    const put: Transport["put"] = (_url, _body, onProgress) =>
      new Promise((resolve) => pending.push({ onProgress, resolve }));
    const { transport } = recording(async () => json(201, UPLOAD), put);
    const progress: UploadProgress[] = [];

    const uploading = uploadSelection(FOLDER, transport, (each) =>
      progress.push(each),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(3);
    pending[0]?.onProgress(40);
    pending[2]?.onProgress(50);
    pending[2]?.resolve({ status: 204, body: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending[0]?.onProgress(100);
    pending[0]?.resolve({ status: 204, body: null });
    pending[1]?.resolve({ status: 204, body: null });
    await uploading;

    expect(progress[0]).toEqual({
      sent: 0,
      total: 152,
      arrived: 0,
      fileCount: 3,
    });
    expect(progress.map(({ sent, arrived }) => [sent, arrived])).toEqual([
      [0, 0],
      [40, 0],
      [90, 0],
      [90, 1],
      [150, 1],
      [150, 2],
      [152, 3],
    ]);
  });

  it(`sends no more than ${PARALLEL_FILES} files at once`, async () => {
    let sending = 0;
    let most = 0;
    const put: Transport["put"] = async (_url, body, onProgress) => {
      sending++;
      most = Math.max(most, sending);
      await new Promise((resolve) => setTimeout(resolve, 1));
      onProgress(body.size);
      sending--;
      return { status: 204, body: null };
    };
    const { transport, puts } = recording(async () => json(201, UPLOAD), put);
    const many: Selection = {
      name: "Many",
      files: Array.from({ length: 25 }, (_, index) => ({
        path: `Many/${index}.dll`,
        file: new Blob(["MZ"]),
      })),
    };

    const result = await uploadSelection(many, transport, () => undefined);

    expect(result.ok).toBe(true);
    expect(puts).toHaveLength(25);
    expect(most).toBe(PARALLEL_FILES);
  });

  it("resolves why the server refused the files, sending none", async () => {
    const { transport, puts } = recording(async () =>
      json(400, {
        message:
          "There is no .exe or .dll among the files given: choose an Assembly, or a folder holding one.",
      }),
    );

    expect(await uploadSelection(FOLDER, transport, () => undefined)).toEqual({
      ok: false,
      message:
        "There is no .exe or .dll among the files given: choose an Assembly, or a folder holding one.",
    });
    expect(puts).toEqual([]);
  });

  it("resolves why the server refused a file, sending no more", async () => {
    const put: Transport["put"] = async (url) =>
      url.endsWith("/0")
        ? {
            status: 400,
            body: { message: '"App/App.dll" is 100 bytes, but 99 were sent.' },
          }
        : { status: 204, body: null };
    const one: Selection = {
      ...FOLDER,
      files: [...FOLDER.files, ...FOLDER.files],
    };
    const { transport, puts } = recording(async () => json(201, UPLOAD), put);

    const result = await uploadSelection(one, transport, () => undefined);

    expect(result).toEqual({
      ok: false,
      message: '"App/App.dll" is 100 bytes, but 99 were sent.',
    });
    expect(puts.length).toBeLessThanOrEqual(PARALLEL_FILES);
  });

  it("says when it cannot reach Xray, before or while sending", async () => {
    const gone = recording(() => Promise.reject(new TypeError("fetch failed")));
    const lost = recording(
      async () => json(201, UPLOAD),
      () => Promise.reject(new Error("Could not send.")),
    );
    const unreachable = {
      ok: false,
      message:
        "Could not reach Xray. Is `xray ui` still running? Start it again, then reload this page.",
    };

    expect(
      await uploadSelection(FOLDER, gone.transport, () => undefined),
    ).toEqual(unreachable);
    expect(
      await uploadSelection(FOLDER, lost.transport, () => undefined),
    ).toEqual(unreachable);
  });
});

describe("startReconstruction, of an upload", () => {
  it("posts the upload and the Assembly in it to reconstruct", async () => {
    const started = {
      id: "1234",
      path: "/tmp/xray-ui-a1b2c3/uploads/5d0c/App/App.dll",
      events: "/api/reconstructions/1234/events",
    };
    const { transport, requests } = recording(async () => json(202, started));

    const result = await startReconstruction(
      { upload: UPLOAD.id, assembly: "App/App.dll" },
      transport,
    );

    expect(result).toEqual({ ok: true, started });
    expect(requests[0]?.init?.body).toBe(
      JSON.stringify({ upload: UPLOAD.id, assembly: "App/App.dll" }),
    );
  });
});

describe("formatBytes", () => {
  it("gives sizes as file managers do", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(12_595)).toBe("12.3 KB");
    expect(formatBytes(40 * 1024 * 1024)).toBe("40.0 MB");
    expect(formatBytes(1.25 * 1024 ** 3)).toBe("1.3 GB");
  });
});
