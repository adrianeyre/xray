// The smoke test against a real application (PRD §3, scenario 1): the
// Assemblies of a permissively licensed .NET console app, as it was
// released, with NuGet dependencies and Sibling Assemblies of its own, are
// reconstructed and built as `xray reconstruct` would, the outcome is checked
// against what it is expected to be, reference by reference, and the rebuilt
// program is run beside the original over inputs that exercise its Sibling
// Assemblies. Which app, and why, is docs/reference/real-app.md.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { compareRuns, type Difference, type ProgramRun } from "@xray/fixtures";

import { nupkgEntries, readNupkgEntry } from "../reconstruct/nupkg.js";
import type { Reconstruction } from "../reconstruct/reconstruct.js";
import type { ReconstructionOutcome } from "../reconstruct/reconstruction-outcome.js";
import type { DependencyResolution } from "../reconstruct/sibling-assemblies.js";

/** A real application, as it was released: a .NET tool's package on nuget.org. */
export interface RealApp {
  readonly name: string;
  /** Who wrote and released it. */
  readonly publisher: string;
  /** Its licence, as an SPDX expression: the package's, and its repository's. */
  readonly licence: string;
  /** Its source, and the commit the package was built from. */
  readonly repository: string;
  readonly commit: string;
  /** The package its Assemblies were released in. */
  readonly package: {
    readonly id: string;
    readonly version: string;
    /** The `.nupkg`'s SHA-512, in base64, as nuget.org's catalog records it. */
    readonly sha512: string;
  };
  /** The folder of the package holding the app, with `/` between segments. */
  readonly folder: string;
  /** The app's Assembly in that folder, which is reconstructed. */
  readonly assembly: string;
}

/**
 * AwsWatchman 2.0.0, Just Eat Takeaway.com's tool that creates and maintains
 * AWS CloudWatch alarms: a .NET 8 console program, `Watchman.dll`, with three
 * Sibling Assemblies of its own (`Watchman.Engine`, `Watchman.Configuration`,
 * `Watchman.AwsResources`) and the NuGet packages it uses beside it.
 */
export const REAL_APP: RealApp = {
  name: "AwsWatchman",
  publisher: "Just Eat Takeaway.com",
  licence: "Apache-2.0",
  repository: "https://github.com/justeattakeaway/AwsWatchman",
  commit: "6360ec8eefaca763ae9c30fbdea256263ad5162a",
  package: {
    id: "JustEatTakeaway.Watchman",
    version: "2.0.0",
    sha512:
      "JcBoCsfPjYovmPJ6x2BpD5+YQrSaMm/kiGkrbqp3cTgvJs8RxQzycQyYmPTpQQj0gN/cT/yzkJNpGjSakSZCFg==",
  },
  folder: "tools/net8.0/any",
  assembly: "Watchman.dll",
};

/** What a Reconstruction of the real app is expected to come to. */
export interface ExpectedReconstruction {
  readonly outcome: ReconstructionOutcome;
  readonly targetFramework: string;
  /**
   * How Dependency Resolution is expected to satisfy each reference that is
   * not the framework's, by the name it gives; any reference not here must
   * be `framework`.
   */
  readonly dependencies: Readonly<Record<string, DependencyResolution>>;
}

/**
 * The AWS SDK's assemblies, each in a package of its own name, that Watchman
 * references. Their assembly version (`3.3.0.0`) is shared by hundreds of
 * releases, and their `AssemblyInformationalVersion` is `1.0.0`, so nothing
 * but `Watchman.deps.json` says which release each is from: Dependency
 * Resolution reads it to find their packages (#47).
 */
const AWS_SDK = [
  "AWSSDK.AutoScaling",
  "AWSSDK.CloudFormation",
  "AWSSDK.CloudFront",
  "AWSSDK.CloudWatch",
  "AWSSDK.Core",
  "AWSSDK.DAX",
  "AWSSDK.DynamoDBv2",
  "AWSSDK.EC2",
  "AWSSDK.ElasticLoadBalancing",
  "AWSSDK.ElasticLoadBalancingV2",
  "AWSSDK.Lambda",
  "AWSSDK.RDS",
  "AWSSDK.S3",
  "AWSSDK.SimpleNotificationService",
  "AWSSDK.StepFunctions",
];

/** What a Reconstruction of {@link REAL_APP} comes to. */
export const EXPECTED_RECONSTRUCTION: ExpectedReconstruction = {
  outcome: "full",
  targetFramework: "net8.0",
  dependencies: {
    "Watchman.AwsResources": "sibling-assembly",
    "Watchman.Configuration": "sibling-assembly",
    "Watchman.Engine": "sibling-assembly",
    "Newtonsoft.Json": "nuget-package",
    StructureMap: "nuget-package",
    ...Object.fromEntries(AWS_SDK.map((name) => [name, "nuget-package"])),
    // In CommandLineParser's package, which only Watchman.deps.json names (#47).
    CommandLine: "nuget-package",
  },
};

/**
 * Watchman's configuration folders the inputs read, by name: each file in
 * each, and what it holds. `no-files` has none.
 */
export const CONFIGURATIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  valid: {
    "payments.json": `${JSON.stringify(
      {
        Name: "Payments",
        AlarmNameSuffix: "payments",
        Targets: [
          { Email: "alerts@example.com" },
          { Url: "https://example.com/alerts" },
        ],
        Services: {
          Lambda: {
            Resources: [
              { Pattern: "^payments-.*$", Values: { Errors: 3 } },
              "refunds",
            ],
          },
          Sqs: { Resources: [{ Name: "payments-queue" }] },
        },
      },
      null,
      2,
    )}\n`,
  },
  "missing-name": {
    "team.json": `${JSON.stringify({
      AlarmNameSuffix: "orders",
      Targets: [{ Email: "alerts@example.com" }],
      Services: { Lambda: { Resources: ["orders"] } },
    })}\n`,
  },
  "missing-suffix": {
    "team.json": `${JSON.stringify({
      Name: "Orders",
      Targets: [{ Email: "alerts@example.com" }],
      Services: { Lambda: { Resources: ["orders"] } },
    })}\n`,
  },
  "no-files": {},
  malformed: { "team.json": '{ "Name": "Broken", ' },
};

/** One run of the real app: its arguments, and the exit code the original gives. */
export interface RealAppInput {
  readonly args: readonly string[];
  readonly exitCode: number;
}

/**
 * The runs the original and the rebuilt app are compared over, with
 * {@link CONFIGURATIONS} written into `configurations`: its usage, version
 * and argument errors, from CommandLineParser and the assembly attributes a
 * Reconstruction recovers; and `TestConfig` runs, which load and validate a
 * configuration folder, with neither AWS nor its credentials, in its
 * Sibling Assemblies, through Newtonsoft.Json and StructureMap.
 */
export function realAppInputs(configurations: string): RealAppInput[] {
  const testConfig = (name: string, exitCode: number): RealAppInput => ({
    args: [
      "--RunMode",
      "TestConfig",
      "--ConfigFolder",
      join(configurations, name),
    ],
    exitCode,
  });
  return [
    { args: ["--help"], exitCode: 1 },
    { args: ["--version"], exitCode: 1 },
    { args: ["--ConfigFolder", configurations, "--Unknown"], exitCode: 1 },
    testConfig("valid", 0),
    testConfig("missing-name", 2),
    testConfig("missing-suffix", 2),
    testConfig("no-files", 2),
    testConfig("malformed", 2),
  ];
}

/** Writes {@link CONFIGURATIONS} into the folder `configurations`, one folder each. */
export async function writeConfigurations(
  configurations: string,
): Promise<void> {
  for (const [name, files] of Object.entries(CONFIGURATIONS)) {
    await mkdir(join(configurations, name), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await writeFile(join(configurations, name, file), content);
    }
  }
}

/** The `.nupkg` of `app`'s package, as nuget.org serves it. */
export function packageUrl(app: RealApp = REAL_APP): string {
  const id = app.package.id.toLowerCase();
  const version = app.package.version.toLowerCase();
  return `https://api.nuget.org/v3-flatcontainer/${id}/${version}/${id}.${version}.nupkg`;
}

/**
 * Downloads `app`'s package from nuget.org and checks it is the very one
 * released. Rejects if it cannot be downloaded, or its SHA-512 is not the
 * one pinned.
 */
export async function downloadPackage(
  app: RealApp = REAL_APP,
  fetchUrl: typeof fetch = fetch,
): Promise<Buffer> {
  const url = packageUrl(app);
  const response = await fetchUrl(url);
  if (!response.ok) {
    throw new Error(
      `Downloading ${url} failed: ${response.status} ${response.statusText}.`,
    );
  }
  const archive = Buffer.from(await response.arrayBuffer());
  checkPackage(archive, app);
  return archive;
}

/** Throws unless `archive` has the SHA-512 pinned for `app`'s package. */
export function checkPackage(archive: Buffer, app: RealApp = REAL_APP): void {
  const sha512 = createHash("sha512").update(archive).digest("base64");
  if (sha512 !== app.package.sha512) {
    throw new Error(
      `${app.package.id} ${app.package.version}'s package has SHA-512 ${sha512}, not ${app.package.sha512}, the one released.`,
    );
  }
}

/**
 * Writes the files in `app`'s folder of the package `archive` into
 * `destination`, as the .NET SDK installs a tool, and resolves with the
 * app's Assembly there. Throws if a path in the package would leave
 * `destination`, or the Assembly is not in it.
 */
export async function extractApp(
  archive: Buffer,
  destination: string,
  app: RealApp = REAL_APP,
): Promise<string> {
  const prefix = `${app.folder}/`;
  let found = false;
  for (const entry of nupkgEntries(archive)) {
    if (!entry.path.startsWith(prefix) || entry.path.endsWith("/")) {
      continue;
    }
    const segments = entry.path.slice(prefix.length).split("/");
    // A `\` or `:` would be a separator, or a drive, to Windows.
    if (segments.some((segment) => /^(\.\.)?$|[\\:]/.test(segment))) {
      throw new Error(
        `${entry.path}, in ${app.package.id}'s package, is not a path inside it.`,
      );
    }
    const path = join(destination, ...segments);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, readNupkgEntry(archive, entry));
    found ||= entry.path === `${prefix}${app.assembly}`;
  }
  if (!found) {
    throw new Error(
      `${app.package.id}'s package holds no ${prefix}${app.assembly}.`,
    );
  }
  return join(destination, app.assembly);
}

/** A Reconstruction the real app's input was accepted for. */
export type AcceptedReconstruction = Extract<
  Reconstruction,
  { readonly accepted: true }
>;

/**
 * How a Reconstruction differs from `expected`, for people: its outcome,
 * target framework, and each reference satisfied otherwise than expected;
 * none if it is as expected.
 */
export function checkReconstruction(
  reconstruction: AcceptedReconstruction,
  expected: ExpectedReconstruction = EXPECTED_RECONSTRUCTION,
): string[] {
  const mismatches: string[] = [];
  if (reconstruction.outcome !== expected.outcome) {
    const why = reconstruction.reasons.map(describeReason).join(" ");
    mismatches.push(
      `It was ${reconstruction.outcome}, not ${expected.outcome}.${why === "" ? "" : ` ${why}`}`,
    );
  }
  const { targetFramework } = reconstruction.solution;
  if (targetFramework !== expected.targetFramework) {
    mismatches.push(
      `It targets ${targetFramework}, not ${expected.targetFramework}.`,
    );
  }
  const actual = new Map(
    reconstruction.dependencies.map((dependency) => [
      dependency.reference.name,
      dependency,
    ]),
  );
  for (const [name, resolution] of Object.entries(expected.dependencies)) {
    const dependency = actual.get(name);
    if (dependency === undefined) {
      mismatches.push(
        `${name} was not referenced; ${resolution} was expected.`,
      );
    } else if (dependency.resolution !== resolution) {
      mismatches.push(
        `${name} was ${dependency.resolution}, not ${resolution}: ${dependency.reason}`,
      );
    }
  }
  for (const [name, dependency] of actual) {
    if (
      !(name in expected.dependencies) &&
      dependency.resolution !== "framework"
    ) {
      mismatches.push(
        `${name} was ${dependency.resolution}, not framework: ${dependency.reason}`,
      );
    }
  }
  return mismatches;
}

function describeReason(
  reason: AcceptedReconstruction["reasons"][number],
): string {
  switch (reason.kind) {
    case "unresolved-dependencies":
      return `Unresolved: ${reason.dependencies.map((d) => d.reference.name).join(", ")}.`;
    case "build-failed":
      return `Its build failed: ${reason.errors
        .slice(0, 5)
        .map(
          ({ file, line, code, message }) =>
            `${file ?? ""}${line === undefined ? "" : `:${line}`}: ${code} ${message}`,
        )
        .join(" ")}`;
    default:
      return `${reason.kind}.`;
  }
}

/** One input, run through the original and the rebuilt app. */
export interface RealAppRun {
  readonly args: readonly string[];
  /** The exit code the original was expected to give. */
  readonly expectedExitCode: number;
  readonly original: ProgramRun;
  readonly rebuilt: ProgramRun | { readonly error: string };
  /** How the rebuilt app behaved differently, stack frames aside; empty if it did not. */
  readonly differences: readonly Difference[];
}

/**
 * Compares two runs of the real app as a Round-trip does, but for the
 * frames of any stack trace they print: each names the file and line it was
 * compiled from, which only the original's PDB can give.
 */
export function compareAppRuns(
  original: ProgramRun,
  rebuilt: ProgramRun | { readonly error: string },
): Difference[] {
  return compareRuns(
    withoutStackFrames(original),
    "error" in rebuilt ? rebuilt : withoutStackFrames(rebuilt),
  );
}

/** `run`, without the lines of its output that are frames of a .NET stack trace (`   at …`). */
export function withoutStackFrames(run: ProgramRun): ProgramRun {
  const strip = (output: string) =>
    output
      .split("\n")
      .filter((line) => !/^\s+at \S/.test(line))
      .join("\n");
  return { ...run, stdout: strip(run.stdout), stderr: strip(run.stderr) };
}

/** What a run of the original app did that was not expected of it; `null` if nothing. */
export function unexpectedOriginal(run: RealAppRun): string | null {
  return run.original.exitCode === run.expectedExitCode
    ? null
    : `The original exited with ${run.original.exitCode}, not ${run.expectedExitCode}.`;
}

/** Everything the smoke test found. */
export interface RealAppResult {
  readonly app: RealApp;
  readonly reconstruction: {
    readonly outcome: ReconstructionOutcome;
    readonly targetFramework: string;
    readonly projects: readonly {
      readonly assemblyName: string;
      readonly typeCount: number;
    }[];
    readonly counts: Readonly<Partial<Record<DependencyResolution, number>>>;
    readonly elapsedMs: number;
    readonly timings: AcceptedReconstruction["timings"];
  };
  /** How the Reconstruction differs from what was expected; empty if it does not. */
  readonly mismatches: readonly string[];
  /** Each input, run through both apps; empty if the Recovered Solution did not build. */
  readonly runs: readonly RealAppRun[];
}

/** Summarizes a Reconstruction of the real app for {@link RealAppResult}. */
export function summarizeReconstruction(
  reconstruction: AcceptedReconstruction,
  elapsedMs: number,
): RealAppResult["reconstruction"] {
  const counts: Partial<Record<DependencyResolution, number>> = {};
  for (const { resolution } of reconstruction.dependencies) {
    counts[resolution] = (counts[resolution] ?? 0) + 1;
  }
  return {
    outcome: reconstruction.outcome,
    targetFramework: reconstruction.solution.targetFramework,
    projects: reconstruction.solution.projects.map(
      ({ assemblyName, typeCount }) => ({ assemblyName, typeCount }),
    ),
    counts,
    elapsedMs,
    timings: reconstruction.timings,
  };
}

/** Whether the smoke test passed: the Reconstruction was as expected, and every run behaved identically, as expected. */
export function realAppPassed(result: RealAppResult): boolean {
  return (
    result.mismatches.length === 0 &&
    result.runs.length > 0 &&
    result.runs.every(
      (run) => run.differences.length === 0 && unexpectedOriginal(run) === null,
    )
  );
}

/** The smoke test's results, for people, as Markdown. */
export function formatRealApp(result: RealAppResult): string {
  const { app, reconstruction, mismatches, runs } = result;
  const { counts, timings } = reconstruction;
  const passed = realAppPassed(result);
  const differing = runs.filter(
    (run) => run.differences.length > 0 || unexpectedOriginal(run) !== null,
  );
  const lines = [
    `## Smoke test: reconstructing ${app.name} ${app.package.version} ${passed ? "passed" : "FAILED"}`,
    "",
    `${app.name}, by ${app.publisher} (${app.licence}, ${app.repository} at ${app.commit.slice(0, 7)}), as released in ${app.package.id} ${app.package.version} on nuget.org, its SHA-512 checked: ${app.folder}/${app.assembly}.`,
    "",
    `- **Outcome**: ${reconstruction.outcome === "full" ? "Full" : reconstruction.outcome === "partial" ? "Partial" : "unverified"} Reconstruction, targeting ${reconstruction.targetFramework}, in ${seconds(reconstruction.elapsedMs)} (resolve dependencies ${seconds(timings.resolveDependencies ?? 0)}, build ${seconds(timings.build ?? 0)}).`,
    `- **Projects**: ${reconstruction.projects.map((project) => `${project.assemblyName} (${project.typeCount} types)`).join(", ")}.`,
    `- **Dependency Resolution**: ${(
      [
        ["framework", "framework"],
        ["nuget-package", "NuGet packages"],
        ["sibling-assembly", "Sibling Assemblies"],
        ["copied-binary", "copied binaries"],
        ["unresolved", "Unresolved Dependencies"],
      ] as const
    )
      .map(([resolution, what]) => `${counts[resolution] ?? 0} ${what}`)
      .join(", ")}.`,
    `- **As expected**: ${mismatches.length === 0 ? "yes, reference by reference." : `NO:\n${mismatches.map((mismatch) => `  - ${mismatch}`).join("\n")}`}`,
    `- **Behaviour**: ${
      runs.length === 0
        ? "not compared, as the Recovered Solution did not build."
        : differing.length === 0
          ? `all ${runs.length} inputs behaved identically, stack frames aside.`
          : `${differing.length} of ${runs.length} inputs did not behave as expected:`
    }`,
  ];
  for (const run of differing) {
    lines.push(`  - Given \`${run.args.join(" ")}\`:`);
    const original = unexpectedOriginal(run);
    if (original !== null) {
      lines.push(`    - ${original}`);
    }
    for (const difference of run.differences) {
      lines.push(`    - ${describeDifference(difference)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function describeDifference(difference: Difference): string {
  switch (difference.kind) {
    case "exit-code":
      return `exit code: original ${difference.original}, rebuilt ${difference.rebuilt}`;
    case "did-not-exit":
      return `the rebuilt app did not run to an exit: ${difference.message}`;
    default: {
      const [first] = difference.lines;
      return `${difference.kind}: ${difference.lines.length} lines differ${first === undefined ? "" : `, first line ${first.line}: original ${JSON.stringify(first.original)}, rebuilt ${JSON.stringify(first.rebuilt)}`}`;
    }
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
