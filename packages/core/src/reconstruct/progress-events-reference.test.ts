import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RECONSTRUCTION_STAGES, type ProgressEvent } from "./progress.js";
import { reconstruct, type ReconstructOptions } from "./reconstruct.js";

// Holds the progress events reference to the events a Reconstruction really
// emits, so the documented shape the server shares cannot drift from them.
// The engine is the fake that answers by file name (../engine/fakes/decompiles.mjs).

const REFERENCE = fileURLToPath(
  new URL("../../../../docs/reference/progress-events.md", import.meta.url),
);

const fakeEngine: ReconstructOptions = {
  dotnetPath: process.execPath,
  enginePath: fileURLToPath(
    new URL("../engine/fakes/decompiles.mjs", import.meta.url),
  ),
  build: false,
};

let reference: string;
const events: ProgressEvent[] = [];
const temporary: string[] = [];

/** Reconstructs the fake engine's `file`, collecting its events; it may fail. */
async function collect(file: string): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "xray-progress-"));
  temporary.push(parent);
  await reconstruct(file, join(parent, "out"), {
    ...fakeEngine,
    onProgress: (event) => events.push(event),
  }).catch(() => undefined);
}

beforeAll(async () => {
  reference = await readFile(REFERENCE, "utf8");
  // Between them: every stage, and every kind of event.
  await collect("slow.dll");
  await collect("undecompilable.dll");
}, 60_000);

afterAll(async () => {
  await Promise.all(
    temporary.map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 5 }),
    ),
  );
});

/** The rows of the first table under `heading`, its header left out, as their cells. */
function table(heading: string): string[][] {
  const section = reference.slice(reference.indexOf(`\n${heading}\n`) + 1);
  const lines = section.split("\n");
  const body = lines.slice(
    lines.findIndex((line) => line.startsWith("|---")) + 1,
  );
  return body
    .slice(
      0,
      body.findIndex((line) => !line.startsWith("|")),
    )
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
}

/** `` `name` `` → `name`. */
function code(cell: string | undefined): string {
  return (cell ?? "").replaceAll("`", "");
}

describe("the progress events reference", () => {
  it("documents every stage, in the order they run", () => {
    expect(table("## Stages").map(([stage]) => code(stage))).toEqual([
      ...RECONSTRUCTION_STAGES,
    ]);
  });

  it("documents every kind of event, and only those emitted", () => {
    const documented = table("## Events").map(([kind]) => code(kind));

    expect(documented.toSorted()).toEqual(
      [...new Set(events.map((event) => event.kind))].toSorted(),
    );
  });

  it("documents each kind's fields, and only those it has", () => {
    const kinds = table("## Events").map(([kind]) => code(kind));
    const fields = table("## Fields");
    for (const kind of kinds) {
      const documented = fields
        .filter(([, , kindsIn]) =>
          kindsIn === "every event"
            ? true
            : (kindsIn ?? "").split(", ").map(code).includes(kind),
        )
        .map(([field]) => code(field));
      for (const event of events.filter((each) => each.kind === kind)) {
        expect(Object.keys(event), kind).toEqual(documented);
      }
    }
  });

  it("documents each field's type", () => {
    const types: Record<string, string> = {
      integer: "number",
      string: "string",
      null: "object",
    };
    for (const [field, type] of table("## Fields")) {
      const allowed = (type ?? "")
        .split("\\|")
        .map((each) => types[each.trim()]);
      for (const event of events) {
        const value = (event as unknown as Record<string, unknown>)[
          code(field)
        ];
        if (value !== undefined) {
          expect(allowed, `${code(field)} = ${String(value)}`).toContain(
            value === null ? "object" : typeof value,
          );
        }
      }
    }
  });

  it("gives an example of events like those emitted", () => {
    const example = reference
      .slice(reference.indexOf("```json\n") + "```json\n".length)
      .split("\n```")[0]
      ?.split("\n")
      .map((line) => JSON.parse(line) as ProgressEvent);

    expect(example?.length).toBeGreaterThan(0);
    for (const event of example ?? []) {
      const like = events.find(
        (each) => each.kind === event.kind && each.stage === event.stage,
      );
      expect(Object.keys(event)).toEqual(Object.keys(like ?? {}));
      if (event.kind === "stage-skipped") {
        expect(event).toMatchObject({
          reason: (like as typeof event).reason,
        });
      }
    }
  });
});
