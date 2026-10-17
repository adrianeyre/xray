import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buffer } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

import { XRAY_REPORT_FILE } from "@xray/core";
import { EVENT_TYPES } from "@xray/web/events";
import { PARALLEL_FILES } from "@xray/web/upload-client";
import { describe, expect, it } from "vitest";

import {
  API_PREFIX,
  attachment,
  formatEvent,
  RECONNECT_MS,
  UPLOAD_LIST_LIMIT,
  type RecoveredFiles,
} from "./api.js";
import type { ReconstructionEvent } from "./reconstructions.js";
import { zipRecoveredSolution } from "./recovered-files.js";
import { readZip } from "./test-zip.js";
import { checkUploadFiles, Upload } from "./uploads.js";

// Holds the `xray ui` reference's account of the API to the server, so it
// cannot drift from it. What each request does is tested in api.test.ts, and
// against the real engine in api.engine.test.ts.

const REFERENCE = fileURLToPath(
  new URL("../../../docs/reference/xray-ui.md", import.meta.url),
);

async function section(heading: string): Promise<string> {
  const reference = await readFile(REFERENCE, "utf8");
  const start = reference.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const level = /^#+/.exec(heading)?.[0] ?? "##";
  const rest = reference.slice(start + heading.length);
  const next = rest.search(new RegExp(`^#{1,${level.length}} `, "m"));
  return next === -1 ? rest : rest.slice(0, next);
}

/** The first column of each row of the first table in `text`. */
function firstColumn(text: string): string[] {
  return [...text.matchAll(/^\| `?([^`|]+?)`? \|/gm)]
    .map((match) => match[1] as string)
    .filter((cell) => !/^(Status|`?event`?|`?kind`?|-+)$/.test(cell));
}

describe("the xray ui reference's API", () => {
  it("gives the requests the server answers, below its prefix", async () => {
    const api = await section("## The API");

    expect(api).toContain(`below \`${API_PREFIX}\``);
    expect(api).toContain(`### \`POST ${API_PREFIX}/uploads\``);
    expect(api).toContain(`### \`PUT ${API_PREFIX}/uploads/<id>/files/<n>\``);
    expect(api).toContain(`### \`POST ${API_PREFIX}/reconstructions\``);
    expect(api).toContain(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/events\``,
    );
    expect(api).toContain(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/files\``,
    );
    expect(api).toContain(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/files/<path>\``,
    );
    expect(api).toContain(`### \`GET ${API_PREFIX}/reconstructions/<id>/zip\``);
  });

  it("gives every status listing a Recovered Solution's files, or sending one, is refused with", async () => {
    const list = await section(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/files\``,
    );
    const file = await section(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/files/<path>\``,
    );

    expect(firstColumn(list).map(Number)).toEqual([404, 409]);
    expect(firstColumn(file).map(Number)).toEqual([404, 409]);
  });

  it("gives the arithmetic Fixture's files as the server lists them: those xray-report.json lists, report last", async () => {
    const list = await section(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/files\``,
    );
    const example = JSON.parse(
      /```json\n([\s\S]*?)```/.exec(list)?.[1] ?? "",
    ) as RecoveredFiles;

    expect(Object.keys(example)).toEqual(["files"]);
    expect(example.files.map((file) => Object.keys(file))).toEqual(
      example.files.map(() => ["path", "size"]),
    );
    expect(example.files.map((file) => file.path)).toEqual([
      "Arithmetic.sln",
      "Arithmetic/Arithmetic.csproj",
      "Arithmetic/Properties/AssemblyInfo.cs",
      "Arithmetic/Program.cs",
      XRAY_REPORT_FILE,
    ]);
  });

  it("gives every status downloading a Recovered Solution is refused with, and the headers it is sent with", async () => {
    const zip = await section(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/zip\``,
    );
    const headers = /```text\n([\s\S]*?)```/.exec(zip)?.[1] ?? "";

    expect(firstColumn(zip).map(Number)).toEqual([404, 409, 413]);
    expect(headers).toBe(
      `Content-Type: application/zip\nContent-Disposition: ${attachment("Arithmetic.zip")}\n`,
    );
  });

  it("gives the arithmetic Fixture's zip as the server makes it: its files, as listed, in a folder named after its solution", async () => {
    const reference = await readFile(REFERENCE, "utf8");
    const downloading = reference.slice(
      reference.indexOf("## Downloading the Recovered Solution"),
    );
    const zipped = /```text\n([\s\S]*?)```/.exec(downloading)?.[1] ?? "";
    const list = await section(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/files\``,
    );
    const listed = JSON.parse(
      /```json\n([\s\S]*?)```/.exec(list)?.[1] ?? "",
    ) as RecoveredFiles;
    // The files, as the list gives them, zipped as the server zips them.
    const directory = await mkdtemp(join(tmpdir(), "xray-reference-test-"));
    try {
      for (const { path } of listed.files) {
        const file = join(directory, ...path.split("/"));
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, path);
      }
      const zip = await zipRecoveredSolution({
        directory,
        solutionPath: "Arithmetic.sln",
        files: listed.files.map((file) => file.path),
      });
      const names = readZip(await buffer(zip.contents)).map(
        (file) => file.name,
      );

      expect(zip.fileName).toBe("Arithmetic.zip");
      expect(zipped.trimEnd().split("\n")).toEqual(names);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(downloading).toContain("`Arithmetic.zip` for `Arithmetic.sln`");
  });

  it("gives every status a start is refused with", async () => {
    const post = await section(`### \`POST ${API_PREFIX}/reconstructions\``);

    expect(firstColumn(post).map(Number)).toEqual([400, 403, 404, 409, 415]);
  });

  it("gives every status an upload, or a file of one, is refused with", async () => {
    const begin = await section(`### \`POST ${API_PREFIX}/uploads\``);
    const put = await section(
      `### \`PUT ${API_PREFIX}/uploads/<id>/files/<n>\``,
    );

    expect(firstColumn(begin).map(Number)).toEqual([400, 403, 413, 415]);
    expect(firstColumn(put).map(Number)).toEqual([400, 403, 404, 409, 415]);
    expect(UPLOAD_LIST_LIMIT).toBe(16 * 1024 * 1024);
    expect(begin).toContain("over 16 MiB");
    expect(PARALLEL_FILES).toBe(4);
    expect(put).toContain("the page sends four at a time");
  });

  it("gives an upload the server takes, and what it answers of it", async () => {
    const begin = await section(`### \`POST ${API_PREFIX}/uploads\``);
    const [request, answer] = [
      ...begin.matchAll(/```json\n([\s\S]*?)```/g),
    ].map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);

    const files = checkUploadFiles(request?.files);
    expect(Array.isArray(files)).toBe(true);
    const upload = new Upload(
      String(answer?.id),
      "/workspace",
      files as Upload["files"],
    );
    expect(answer).toEqual({
      id: answer?.id,
      files: `${API_PREFIX}/uploads/${String(answer?.id)}/files`,
      assemblies: upload.choice.assemblies,
      assembly: upload.choice.assembly,
    });
  });

  it("gives every type of event in the stream, and every way it ends", async () => {
    const stream = await section(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/events\``,
    );
    const [types, kinds] = stream
      .split("`ended`'s `data` is one of")
      .map(firstColumn);
    const ended: ReconstructionEvent["type"] = "ended";

    expect(types).toEqual([...EVENT_TYPES]);
    expect(types).toContain(ended);
    expect(kinds).toEqual(["reconstructed", "rejected", "failed"]);
  });

  it("gives the stream's retry, and its events as the server writes them", async () => {
    const stream = await section(
      `### \`GET ${API_PREFIX}/reconstructions/<id>/events\``,
    );
    const example = /```text\n([\s\S]*?)```/.exec(stream)?.[1] ?? "";

    expect(stream).toContain(`\`retry: ${RECONNECT_MS}\``);
    expect(example.startsWith(`retry: ${RECONNECT_MS}\n\n`)).toBe(true);
    const blocks = example
      .split("\n\n")
      .slice(1)
      .filter((block) => !block.startsWith("…"));
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) {
      const id = Number(/^id: (\d+)$/m.exec(block)?.[1]);
      const type = /^event: (\w+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "";
      if (data.includes("…")) {
        // Cut short; the rest of it is what the server writes.
        expect(
          formatEvent(id, { type, data: {} } as ReconstructionEvent),
        ).toMatch(new RegExp(`^id: ${id}\nevent: ${type}\ndata: `));
        continue;
      }
      const event = { type, data: JSON.parse(data) } as ReconstructionEvent;
      expect(formatEvent(id, event)).toBe(`${block}\n\n`);
    }
  });
});
