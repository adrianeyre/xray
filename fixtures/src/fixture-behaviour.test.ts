import { beforeAll, describe, expect, it } from "vitest";

import {
  buildFixture,
  listFixtures,
  readFixtureInputs,
  type BuiltFixture,
} from "./fixtures.js";
import { runAssembly, runsOn } from "./run-assembly.js";

// Every console Fixture, built from source, does exactly what its inputs.json
// says on this OS. CI runs this on all three, so the output is deterministic
// across them too — a Round-trip can only compare deterministic programs. A
// .NET Framework Fixture runs only on Windows, so elsewhere its runs are skipped.

// A run of the benchmark Fixture, of about 2,000 types, can take longer than
// vitest's default 5 s on a busy CI runner.
const RUN_TIMEOUT_MS = 60_000;

const fixtures = await Promise.all(
  (await listFixtures()).map(async (name) => ({
    name,
    inputs: await readFixtureInputs(name),
  })),
);

/** Output as lines, whatever the OS's line ending. */
function lines(output: string): string[] {
  const split = output.replaceAll("\r\n", "\n").split("\n");
  if (split.at(-1) === "") {
    split.pop();
  }
  return split;
}

describe.each(fixtures.filter(({ inputs }) => inputs.length > 0))(
  "the $name Fixture",
  ({ name, inputs }) => {
    let fixture: BuiltFixture;
    beforeAll(async () => {
      fixture = await buildFixture(name);
    });

    it.for(inputs.map((input) => ({ ...input, shown: input.args.join(" ") })))(
      "behaves as expected given [$shown]",
      { timeout: RUN_TIMEOUT_MS },
      async ({ args, expected }, { skip }) => {
        const { assemblyPath, targetFramework } = fixture;
        skip(
          !runsOn(targetFramework),
          `${targetFramework} programs run only on Windows`,
        );
        const run = await runAssembly(assemblyPath, args, { targetFramework });

        expect({
          stdout: lines(run.stdout),
          stderr: lines(run.stderr),
          exitCode: run.exitCode,
        }).toEqual(expected);
      },
    );
  },
);

describe("the Fixtures", () => {
  it.each([
    "arithmetic",
    "async-await",
    "classes-structs",
    "closures-linq",
    "control-flow",
    "copied-binary",
    "debug-symbols",
    "generated-regex",
    "generics",
    "microsoft-packages",
    "multi-assembly",
    "net35-library",
    "net48-console",
    "netcoreapp31-console",
    "netstandard20-library",
    "newer-features",
    "records-patterns",
    "resources",
    "unsafe-nullable",
  ])("include the %s console Fixture, with inputs", (name) => {
    expect(
      fixtures.find((fixture) => fixture.name === name)?.inputs.length,
    ).toBeGreaterThan(0);
  });

  it.each(["net48-winforms", "net48-wpf", "winforms", "wpf"])(
    "include the %s GUI Fixture, without inputs",
    (name) => {
      expect(fixtures.find((fixture) => fixture.name === name)?.inputs).toEqual(
        [],
      );
    },
  );
});
