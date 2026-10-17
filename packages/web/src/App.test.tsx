// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { App } from "./App.js";
import type { CreateViewer, ViewerPosition } from "./code-viewer.js";
import type {
  ProgressEvent,
  ReconstructionEnd,
  ReportSummary,
} from "./events.js";
import type {
  DirectoryEntryLike,
  EntryLike,
  FileEntryLike,
} from "./file-selection.js";
import type { Answer, Transport } from "./reconstruction-client.js";
import { ARITHMETIC } from "./test-inspection.js";
import {
  json,
  recording,
  type FakeEventSource,
  type Recorded,
} from "./test-transport.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PATH = "/fixtures/arithmetic/Arithmetic.dll";
const EVENTS = `/api/reconstructions/${ID}/events`;

interface Rendered extends Recorded {
  readonly followed: string[];
  /** The stream the page opened, which must be the only one. */
  readonly source: () => FakeEventSource;
}

/** The arithmetic Fixture's Recovered Solution, as @xray/core writes it, report last. */
const SOLUTION: Readonly<Record<string, string>> = {
  "Arithmetic.sln":
    "Microsoft Visual Studio Solution File, Format Version 12.00\n",
  "Arithmetic/Arithmetic.csproj":
    '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n',
  "Arithmetic/Properties/AssemblyInfo.cs":
    '[assembly: AssemblyVersion("1.0.0.0")]\n',
  "Arithmetic/Program.cs":
    "internal class Program\n{\n\tprivate static int Main(string[] args)\n\t{\n\t\treturn 0;\n\t}\n}\n",
  "xray-report.json": '{\n  "schemaVersion": 1\n}\n',
};

const FILES = `/api/reconstructions/${ID}/files`;

/** The server's answers about the Recovered Solution: its files, and each one. */
async function solutionAnswer(url: string): Promise<Response> {
  if (url === FILES) {
    return json(200, {
      files: Object.entries(SOLUTION).map(([path, text]) => ({
        path,
        size: new TextEncoder().encode(text).length,
      })),
    });
  }
  const path = decodeURIComponent(url.slice(`${FILES}/`.length));
  const text = SOLUTION[path];
  return text === undefined
    ? json(404, {
        message: `There is no file "${path}" in the Recovered Solution.`,
      })
    : new Response(text, { status: 200 });
}

/** A code viewer that records what it is told to show, as Monaco would show it. */
interface FakeViewer {
  readonly createViewer: CreateViewer;
  /** Each file shown, in order, with where in it, if anywhere. */
  readonly shown: { path: string; text: string; at?: ViewerPosition }[];
  /** The element each viewer made fills. */
  readonly hosts: HTMLElement[];
  readonly disposed: () => number;
}

function fakeViewer(): FakeViewer {
  const shown: FakeViewer["shown"] = [];
  const hosts: HTMLElement[] = [];
  let disposed = 0;
  return {
    shown,
    hosts,
    disposed: () => disposed,
    createViewer: async (element) => {
      hosts.push(element);
      return {
        show: (path, text, at) =>
          shown.push(at === undefined ? { path, text } : { path, text, at }),
        dispose: () => {
          disposed += 1;
        },
      };
    },
  };
}

function render(
  options: {
    readonly reconstruction?: string;
    readonly answer?: () => Promise<Response>;
    /** How the server answers about the Recovered Solution; with the arithmetic Fixture's if absent. */
    readonly files?: (
      url: string,
      init: RequestInit | undefined,
    ) => Promise<Response>;
    readonly viewer?: FakeViewer;
  } = {},
): Rendered {
  const answer =
    options.answer ??
    (async () => json(202, { id: ID, path: PATH, events: EVENTS }));
  const files = options.files ?? solutionAnswer;
  const recorded = recording((url, init) =>
    url.startsWith(FILES) ? files(url, init) : answer(),
  );
  const followed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <App
        transport={recorded.transport}
        reconstruction={options.reconstruction ?? null}
        onFollow={(id) => followed.push(id)}
        createViewer={(options.viewer ?? fakeViewer()).createViewer}
      />,
    ),
  );
  return {
    ...recorded,
    followed,
    source: () => {
      expect(recorded.sources).toHaveLength(1);
      return recorded.sources[0] as FakeEventSource;
    },
  };
}

function input(): HTMLInputElement {
  return document.querySelector("#assembly-path") as HTMLInputElement;
}

function button(): HTMLButtonElement {
  return document.querySelector(".path-form button") as HTMLButtonElement;
}

/** Types `path` into the box, as the user does, and submits it. */
async function reconstruct(path: string): Promise<void> {
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(input(), path);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    button().click();
  });
}

function send(source: FakeEventSource, type: string, data: unknown): void {
  act(() => source.dispatch(type, JSON.stringify(data)));
}

function progress(source: FakeEventSource, event: ProgressEvent): void {
  send(source, "progress", event);
}

/** Each stage, as `status` and what it shows, in order. */
function stages(): string[] {
  return [...document.querySelectorAll(".stage")].map(
    (stage) =>
      `${(stage as HTMLElement).dataset.status}: ${stage.textContent ?? ""}`,
  );
}

function alertText(): string[] {
  return [...document.querySelectorAll('[role="alert"]')].map(
    (alert) => alert.textContent ?? "",
  );
}

const report: ReportSummary = {
  outcome: "full",
  reasons: [],
  solution: {
    solutionPath: "Arithmetic.sln",
    projectPath: "Arithmetic/Arithmetic.csproj",
    targetFramework: "net8.0",
    outputType: "Exe",
    typeCount: 1,
    sourceFileCount: 1,
    projects: [
      {
        assemblyName: "Arithmetic",
        projectPath: "Arithmetic/Arithmetic.csproj",
        typeCount: 1,
        pdb: { status: "none" },
        obfuscation: { status: "clean", indicators: [] },
        projectReferences: [],
        resources: [],
      },
    ],
    files: Object.keys(SOLUTION),
  },
  inputs: { options: { siblings: true } },
  dependencies: ["System.Console", "System.Runtime"].map((name) => ({
    reference: {
      name,
      version: "8.0.0.0",
      culture: null,
      publicKeyToken: "b03f5f7f11d50a3a",
    },
    referencedBy: ["Arithmetic"],
    resolution: "framework",
    package: null,
    projectPath: null,
    copiedTo: null,
    reason: `${name} is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), so it is the framework's, or one of Microsoft's own packages, and is left to the target framework.`,
  })),
  warnings: [],
  siblingProblems: [],
  build: { succeeded: true, diagnostics: [] },
  timings: {
    analyse: 93,
    decompile: 1_607,
    resolveDependencies: 12,
    generate: 5,
    build: 2_595,
    run: null,
    total: 4_321,
  },
};

describe("App", () => {
  it("renders the shell: a header, the path box, and that it runs only on this machine", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("<h1>Xray</h1>");
    expect(html).toContain(
      '<main id="content" class="shell-main" aria-label="Reconstruction" tabindex="-1">',
    );
    expect(html).toContain(
      '<label for="assembly-path">Path to an Assembly, or a folder holding one, on this machine</label>',
    );
    expect(html).toContain('<button type="submit">Reconstruct</button>');
    expect(html).not.toContain("Reconstruction progress");
    expect(html).toContain("Runs only on this machine");
    expect(html).not.toContain("Inspect summary");
  });

  it("states its intended use, before anything is given it", () => {
    render();

    const notice = document.querySelector(
      'aside[aria-label="Intended use"]',
    ) as HTMLElement;
    expect(notice.textContent).toBe(
      "Intended use. Xray is for Assemblies you own or have the right to analyse: recovering lost source for your own software, studying how C# features compile, or maintaining legacy internal applications. It does not undo obfuscation, or bypass licence checks or any other protection.",
    );
    // Above where an Assembly is given it.
    const main = document.querySelector(".shell-main") as HTMLElement;
    expect(main.firstElementChild).toBe(notice);
  });

  it("shows the Assembly's inspect summary once analyse has read it, field by field and as xray inspect --json prints it", async () => {
    const page = render();
    await reconstruct(PATH);
    const source = page.source();
    send(source, "started", { path: PATH });
    progress(source, { kind: "stage-started", stage: "analyse", elapsedMs: 0 });

    expect(document.querySelector(".inspect")).toBeNull();

    send(source, "inspected", ARITHMETIC);

    const panel = document.querySelector(
      'section[aria-label="Inspect summary"]',
    ) as HTMLElement;
    expect(panel.querySelector("h2")?.textContent).toBe(
      "Inspect summary Arithmetic",
    );
    expect(
      [...panel.querySelectorAll(".facts div")].map((fact) => [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ]),
    ).toEqual([
      ["File", ARITHMETIC.path],
      ["Assembly", "Arithmetic"],
      ["Version", "1.0.0.0"],
      ["Culture", "neutral"],
      ["Public key token", "none: not strong-named"],
      ["Target framework", "net8.0"],
      ["Framework name", ".NETCoreApp,Version=v8.0"],
      ["Runtime version", "v4.0.30319"],
      ["Told from", "its TargetFrameworkAttribute"],
      ["Support", "full"],
      ["Platform target", "AnyCPU"],
      ["Prefer 32-bit", "no"],
      ["Bitness", "any: whatever the OS is"],
      ["Machine", "I386"],
      ["Entry point", "Arithmetic.Program.Main"],
      ["Output kind", "Console"],
      ["Types", "1"],
      ["Methods", "9"],
      ["Resources", "0"],
      ["PDB", "none beside it"],
      ["Obfuscation", "clean: no sign of it found"],
    ]);
    expect(panel.querySelector("h3")?.textContent).toBe("2 references");
    expect(
      [...panel.querySelectorAll(".references tbody tr")].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["System.Console", "8.0.0.0", "neutral", "b03f5f7f11d50a3a"],
      ["System.Runtime", "8.0.0.0", "neutral", "b03f5f7f11d50a3a"],
    ]);
    // What `xray inspect --json` prints, but for its last line break.
    expect(panel.querySelector(".inspect-json pre")?.textContent).toBe(
      JSON.stringify(ARITHMETIC, null, 2),
    );
    expect(panel.querySelector(".inspect-json summary")?.textContent).toBe(
      "As xray inspect --json prints it",
    );

    // It stays once the Reconstruction has ended.
    progress(source, {
      kind: "stage-finished",
      stage: "analyse",
      elapsedMs: 90,
      durationMs: 90,
    });
    send(source, "ended", {
      kind: "reconstructed",
      directory: `/tmp/xray-ui-abc123/reconstructions/${ID}`,
      report,
    } satisfies ReconstructionEnd);
    expect(document.querySelector(".inspect")).toBe(panel);
  });

  it("reconstructs Sibling Assemblies unless turned off, which cannot be changed while a Reconstruction runs", async () => {
    const page = render();
    const siblings = () =>
      document.querySelector("#siblings") as HTMLInputElement;

    expect(siblings().checked).toBe(true);
    expect(document.querySelector('label[for="siblings"]')?.textContent).toBe(
      "Reconstruct Sibling Assemblies",
    );
    expect(document.querySelector("#siblings-hint")?.textContent).toBe(
      "Each of the application's own Assemblies beside it that it references becomes a project of its own in the solution. Turned off, each is copied into the solution as it is, and referenced there.",
    );
    await act(async () => {
      siblings().click();
    });
    expect(siblings().checked).toBe(false);
    await reconstruct(PATH);

    expect(page.requests[0]?.init?.body).toBe(
      JSON.stringify({ path: PATH, siblings: false }),
    );
    act(() => page.source().open());
    expect(siblings().disabled).toBe(true);
    send(page.source(), "ended", {
      kind: "failed",
      code: null,
      message: "Stopped.",
    } satisfies ReconstructionEnd);
    expect(siblings().disabled).toBe(false);
  });

  it("shows how many Sibling Assemblies it has reconstructed, of how many, as it resolves dependencies", async () => {
    const page = render();

    await reconstruct(PATH);
    const source = page.source();
    act(() => source.open());
    send(source, "started", { path: PATH });
    progress(source, {
      kind: "stage-started",
      stage: "resolve-dependencies",
      elapsedMs: 700,
    });
    progress(source, {
      kind: "stage-progress",
      stage: "resolve-dependencies",
      elapsedMs: 950,
      done: 1,
      total: 2,
      current: "Pricing.dll",
    });

    expect(stages()[2]).toBe(
      "running: 3. Resolve dependenciesRunning250 ms1 of 2 Sibling Assemblies: Pricing.dll",
    );
  });

  it("reconstructs the path typed, showing each stage as it progresses, then the outcome", async () => {
    const page = render();

    await reconstruct(`  ${PATH} `);
    const source = page.source();
    act(() => source.open());
    send(source, "started", { path: PATH });
    progress(source, { kind: "stage-started", stage: "analyse", elapsedMs: 0 });
    progress(source, {
      kind: "stage-finished",
      stage: "analyse",
      elapsedMs: 93,
      durationMs: 93,
    });
    progress(source, {
      kind: "stage-started",
      stage: "decompile",
      elapsedMs: 93,
    });
    progress(source, {
      kind: "stage-progress",
      stage: "decompile",
      elapsedMs: 1_593,
      done: 0,
      total: 1,
      current: "Arithmetic.Program",
    });

    expect(page.requests[0]?.init?.body).toBe(
      JSON.stringify({ path: `  ${PATH} `, siblings: true }),
    );
    expect(source.url).toBe(EVENTS);
    expect(page.followed).toEqual([ID]);
    expect(document.querySelector(".reconstruction h2")?.textContent).toBe(
      `Reconstructing ${PATH}`,
    );
    expect(stages()).toEqual([
      "finished: 1. AnalyseDone93 ms",
      "running: 2. DecompileRunning1.5 s0 of 1 type: Arithmetic.Program",
      "waiting: 3. Resolve dependenciesWaiting",
      "waiting: 4. Generate solutionWaiting",
      "waiting: 5. BuildWaiting",
      "waiting: 6. Run the rebuilt programWaiting",
    ]);
    // One Reconstruction at a time.
    expect(button().disabled).toBe(true);

    progress(source, {
      kind: "stage-finished",
      stage: "decompile",
      elapsedMs: 1_700,
      durationMs: 1_607,
    });
    progress(source, {
      kind: "stage-skipped",
      stage: "resolve-dependencies",
      elapsedMs: 1_700,
      reason: "Xray does not resolve dependencies yet.",
    });
    progress(source, {
      kind: "stage-started",
      stage: "generate",
      elapsedMs: 1_700,
    });
    progress(source, {
      kind: "stage-finished",
      stage: "generate",
      elapsedMs: 1_705,
      durationMs: 5,
    });
    progress(source, {
      kind: "stage-started",
      stage: "build",
      elapsedMs: 1_705,
    });
    progress(source, {
      kind: "stage-progress",
      stage: "build",
      elapsedMs: 2_955,
      done: null,
      total: null,
      current: null,
    });
    expect(stages()[4]).toBe("running: 5. BuildRunning1.3 s");

    progress(source, {
      kind: "stage-finished",
      stage: "build",
      elapsedMs: 4_300,
      durationMs: 2_595,
    });
    progress(source, {
      kind: "stage-skipped",
      stage: "run",
      elapsedMs: 4_300,
      reason:
        "Running the rebuilt program executes recovered code, so it is run only when asked.",
    });
    send(source, "ended", {
      kind: "reconstructed",
      directory: `/tmp/xray-ui-abc123/reconstructions/${ID}`,
      report,
    } satisfies ReconstructionEnd);

    expect(stages()).toEqual([
      "finished: 1. AnalyseDone93 ms",
      "finished: 2. DecompileDone1.6 s",
      "skipped: 3. Resolve dependenciesSkippedXray does not resolve dependencies yet.",
      "finished: 4. Generate solutionDone5 ms",
      "finished: 5. BuildDone2.6 s",
      "skipped: 6. Run the rebuilt programSkippedRunning the rebuilt program executes recovered code, so it is run only when asked.",
    ]);
    expect(document.querySelector(".reconstruction h2")?.textContent).toBe(
      `Reconstructed ${PATH}`,
    );
    const outcome = document.querySelector(".outcome") as HTMLElement;
    expect(outcome.dataset.outcome).toBe("full");
    expect(outcome.querySelector("h3")?.textContent).toBe(
      "Full Reconstruction",
    );
    expect(outcome.textContent).toContain("The Recovered Solution builds.");
    expect(
      [...outcome.querySelectorAll(".facts div")].map(
        (fact) => fact.textContent,
      ),
    ).toEqual([
      `Recovered Solution/tmp/xray-ui-abc123/reconstructions/${ID}`,
      "SolutionArithmetic.sln",
      "ProjectArithmetic/Arithmetic.csproj",
      "Target frameworknet8.0",
      "Output typeExe",
      "Types1, each decompiled to a file of its own",
      "Resourcesnone",
      "PDBnone beside the Assembly",
      "Obfuscationclean: no sign of it found",
      "Dependencies2 references: 2 framework",
      "Sibling Assembliesnone found beside it",
      "Buildsucceeded",
      "Time4.3 s",
    ]);
    expect(source.closed).toBe(true);
    expect(button().disabled).toBe(false);
    expect(alertText()).toEqual([]);
  });

  it("shows every one of a Partial Reconstruction's build errors at its file and line, then its warnings", async () => {
    const page = render();
    await reconstruct(PATH);
    const warning = {
      severity: "warning" as const,
      code: "CS8618",
      message: "Non-nullable field 'name' must contain a non-null value.",
      file: "App/Program.cs",
      line: 1,
      column: 1,
    };
    const errors = Array.from({ length: 12 }, (_, index) => ({
      severity: "error" as const,
      code: "CS0103",
      message: `The name 'x${index}' does not exist in the current context`,
      file: "App/Program.cs",
      line: index + 1,
      column: 5,
    }));

    send(page.source(), "ended", {
      kind: "reconstructed",
      directory: "/tmp/out",
      report: {
        ...report,
        outcome: "partial",
        reasons: [{ kind: "build-failed", errors }],
        build: { succeeded: false, diagnostics: [warning, ...errors] },
      },
    } satisfies ReconstructionEnd);

    const outcome = document.querySelector(".outcome") as HTMLElement;
    expect(outcome.querySelector("h3")?.textContent).toBe(
      "Partial Reconstruction",
    );
    expect(outcome.textContent).toContain(
      "Partial, because the Recovered Solution did not build, with 12 errors, listed below at their files and lines.",
    );
    const listed = [...document.querySelectorAll(".diagnostics li")].map(
      (item) => item.textContent,
    );
    expect(listed).toHaveLength(13);
    expect(listed[0]).toBe(
      "App/Program.cs:1:5: error CS0103: The name 'x0' does not exist in the current context",
    );
    expect(listed[11]).toBe(
      "App/Program.cs:12:5: error CS0103: The name 'x11' does not exist in the current context",
    );
    expect(listed[12]).toBe(
      "App/Program.cs:1:1: warning CS8618: Non-nullable field 'name' must contain a non-null value.",
    );
  });

  describe("shows errors clearly", () => {
    it("a path the server refuses, beside the box, starting nothing", async () => {
      const message =
        '"bin/App.dll" is not a full path. Enter the Assembly\'s full path, from the root of its file system, such as /home/me/MyApp.dll.';
      const page = render({ answer: async () => json(400, { message }) });

      await reconstruct("bin/App.dll");

      expect(alertText()).toEqual([message]);
      expect(input().getAttribute("aria-invalid")).toBe("true");
      expect(input().getAttribute("aria-describedby")).toBe(
        "assembly-path-error",
      );
      expect(page.sources).toEqual([]);
      expect(document.querySelector(".reconstruction")).toBeNull();
      expect(button().disabled).toBe(false);
    });

    it("input that is not a Managed Assembly, saying why Xray cannot reconstruct it", async () => {
      const page = render();
      await reconstruct("/fixtures/native/hello.exe");
      // As @xray/core explains the native Fixture.
      const explanation = [
        '"hello.exe" is a Native Executable (x64 machine code), not a Managed Assembly, so Xray cannot reconstruct it.',
        "It has no CLI header: it was compiled straight to machine code (from C, C++, Rust, Go or similar), which discards the types, members and signatures that .NET IL and metadata keep. The most that could be recovered from it is pseudocode, never a C# solution that builds and behaves like the original.",
        "Xray reconstructs Managed Assemblies only: .exe and .dll files of .NET IL and metadata.",
      ].join("\n");
      send(page.source(), "started", { path: "/fixtures/native/hello.exe" });

      progress(page.source(), {
        kind: "stage-started",
        stage: "analyse",
        elapsedMs: 0,
      });
      progress(page.source(), {
        kind: "stage-finished",
        stage: "analyse",
        elapsedMs: 80,
        durationMs: 80,
      });
      send(page.source(), "ended", {
        kind: "rejected",
        inputKind: "native-executable",
        explanation,
      } satisfies ReconstructionEnd);

      expect(alertText()).toEqual([
        `Xray cannot reconstruct this file${explanation}`,
      ]);
      expect(stages().map((stage) => stage.split(":")[0])).toEqual([
        "finished",
        "waiting",
        "waiting",
        "waiting",
        "waiting",
        "waiting",
      ]);
      expect(document.querySelector(".reconstruction h2")?.textContent).toBe(
        "Could not reconstruct /fixtures/native/hello.exe",
      );
      // It has no metadata to summarize.
      expect(document.querySelector(".inspect")).toBeNull();
      expect(button().disabled).toBe(false);
    });

    it("a file that is not a PE file at all, saying what it is", async () => {
      const page = render();
      await reconstruct("/notes/readme.txt");
      const explanation = [
        '"readme.txt" is not a PE file: it does not start with the "MZ" signature every PE file has. It is neither a Managed Assembly nor a Native Executable, so Xray cannot reconstruct it.',
        "Xray reconstructs Managed Assemblies only: .exe and .dll files of .NET IL and metadata.",
      ].join("\n");
      send(page.source(), "started", { path: "/notes/readme.txt" });
      send(page.source(), "ended", {
        kind: "rejected",
        inputKind: "not-pe",
        explanation,
      } satisfies ReconstructionEnd);

      const rejection = document.querySelector(
        '[data-outcome="rejected"]',
      ) as HTMLElement;
      expect(rejection.getAttribute("role")).toBe("alert");
      expect(rejection.querySelector("h3")?.textContent).toBe(
        "Xray cannot reconstruct this file",
      );
      // Shown a paragraph to each line, by app.css's white-space: pre-line.
      expect(rejection.querySelector(".explanation")?.textContent).toBe(
        explanation,
      );
      expect(document.querySelector(".inspect")).toBeNull();
    });

    it("a Reconstruction that failed, at the stage it failed in", async () => {
      const page = render();
      await reconstruct("/nowhere/App.dll");
      const message = "There is no file at /nowhere/App.dll.";

      progress(page.source(), {
        kind: "stage-started",
        stage: "analyse",
        elapsedMs: 0,
      });
      progress(page.source(), {
        kind: "stage-failed",
        stage: "analyse",
        elapsedMs: 40,
        durationMs: 40,
        message,
      });
      send(page.source(), "ended", {
        kind: "failed",
        code: "not-found",
        message,
      } satisfies ReconstructionEnd);

      expect(stages()[0]).toBe(`failed: 1. AnalyseFailed40 ms${message}`);
      expect(alertText()).toEqual([`The Reconstruction failed${message}`]);
      expect(button().disabled).toBe(false);
    });

    it("that it cannot reach Xray", async () => {
      render({ answer: () => Promise.reject(new TypeError("fetch failed")) });

      await reconstruct(PATH);

      expect(alertText()).toEqual([
        "Could not reach Xray. Is `xray ui` still running? Start it again, then reload this page.",
      ]);
    });
  });

  describe("reconnecting", () => {
    it("follows the Reconstruction the address names, as when the page is loaded again, showing all of it so far", () => {
      const page = render({ reconstruction: ID });
      const source = page.source();

      act(() => source.open());
      send(source, "started", { path: PATH });
      progress(source, {
        kind: "stage-started",
        stage: "analyse",
        elapsedMs: 0,
      });
      send(source, "inspected", ARITHMETIC);
      progress(source, {
        kind: "stage-finished",
        stage: "analyse",
        elapsedMs: 90,
        durationMs: 90,
      });
      progress(source, {
        kind: "stage-started",
        stage: "decompile",
        elapsedMs: 90,
      });

      expect(source.url).toBe(EVENTS);
      expect(input().value).toBe(PATH);
      expect(document.querySelector(".inspect h2")?.textContent).toBe(
        "Inspect summary Arithmetic",
      );
      expect(stages().slice(0, 2)).toEqual([
        "finished: 1. AnalyseDone90 ms",
        "running: 2. DecompileRunning0 ms",
      ]);
      expect(button().disabled).toBe(true);
    });

    it("says so while the connection is lost, and carries on where it left off once it is back", () => {
      const page = render({ reconstruction: ID });
      const source = page.source();
      act(() => source.open());
      progress(source, {
        kind: "stage-started",
        stage: "analyse",
        elapsedMs: 0,
      });

      act(() => source.lose());
      expect(document.querySelector('[role="status"]')?.textContent).toBe(
        "Lost the connection to Xray. Connecting again, to carry on where it left off…",
      );

      act(() => source.open());
      progress(source, {
        kind: "stage-finished",
        stage: "analyse",
        elapsedMs: 90,
        durationMs: 90,
      });
      expect(document.querySelector('[role="status"]')).toBeNull();
      expect(stages()[0]).toBe("finished: 1. AnalyseDone90 ms");
      expect(page.sources).toHaveLength(1);
    });

    it("says why when the Reconstruction is gone, as after Xray restarts", async () => {
      const message =
        "There is no such Reconstruction: Xray has been restarted since it ran, or it never did. Reconstruct the Assembly again.";
      const page = render({
        reconstruction: ID,
        answer: async () => json(404, { message }),
      });

      await act(async () => page.source().refuse());

      expect(alertText()).toEqual([message]);
      expect(button().disabled).toBe(false);
    });
  });
});

describe("App, uploading", () => {
  const UPLOAD_ID = "5d0c1f9e-3c1e-4c55-9d6b-9f0e4c2b7a10";
  const FILES = `/api/uploads/${UPLOAD_ID}/files`;
  const UPLOADED = `/tmp/xray-ui-a1b2c3/uploads/${UPLOAD_ID}/App/App.dll`;

  /** A page whose server answers each request by its address, and takes each file as the test says. */
  function renderServer(
    options: {
      readonly assembly?: string | null;
      readonly uploadAnswer?: Response;
      readonly put?: Transport["put"];
    } = {},
  ): Rendered {
    const recorded = recording(async (url) => {
      if (url === "/api/uploads") {
        return (
          options.uploadAnswer ??
          json(201, {
            id: UPLOAD_ID,
            files: FILES,
            assemblies: ["App/App.dll", "App/libs/Library.dll"],
            assembly:
              options.assembly === undefined ? "App/App.dll" : options.assembly,
          })
        );
      }
      return json(202, { id: ID, path: UPLOADED, events: EVENTS });
    }, options.put);
    const followed: string[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        <App
          transport={recorded.transport}
          onFollow={(id) => followed.push(id)}
        />,
      ),
    );
    return {
      ...recorded,
      followed,
      source: () => {
        expect(recorded.sources).toHaveLength(1);
        return recorded.sources[0] as FakeEventSource;
      },
    };
  }

  function fileEntry(name: string, contents: string): FileEntryLike {
    return {
      isFile: true,
      isDirectory: false,
      name,
      file: (success) => success(new File([contents], name)),
    };
  }

  function folderEntry(name: string, entries: EntryLike[]): DirectoryEntryLike {
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => {
        let given = false;
        return {
          readEntries: (success) => {
            success(given ? [] : entries);
            given = true;
          },
        };
      },
    };
  }

  const APP_FOLDER = folderEntry("App", [
    fileEntry("App.dll", "MZ" + "a".repeat(98)),
    fileEntry("App.runtimeconfig.json", "{}"),
    folderEntry("libs", [fileEntry("Library.dll", "MZ" + "b".repeat(48))]),
  ]);

  /** Drops `entries` on the drop zone, as the user does from their file manager. */
  async function dropOn(entries: EntryLike[]): Promise<void> {
    const zone = document.querySelector(".drop-zone") as HTMLElement;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        items: entries.map((entry) => ({
          kind: "file",
          webkitGetAsEntry: () => entry,
        })),
        files: [],
        dropEffect: "none",
      },
    });
    await act(async () => {
      zone.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** Chooses `files` with the picker `id`, as the user does. */
  async function pick(id: string, files: File[]): Promise<void> {
    const input = document.querySelector(`#${id}`) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: files,
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function uploadButtons(): HTMLButtonElement[] {
    return [
      ...document.querySelectorAll(".drop-zone button"),
    ] as HTMLButtonElement[];
  }

  function uploadStatus(): string {
    return document.querySelector(".upload-progress")?.textContent ?? "";
  }

  it("offers to drop an Assembly or a folder, or to choose either with a picker", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain(
      "Drop an Assembly (<code>.exe</code> or <code>.dll</code>), or a folder holding one, here",
    );
    expect(html).toContain('<button type="button">Choose a file…</button>');
    expect(html).toContain('<button type="button">Choose a folder…</button>');
    expect(html).toContain(
      '<input id="upload-file" type="file" accept=".exe,.dll" hidden=""/>',
    );
    expect(html).toContain("deleted when Xray stops");
  });

  it("gives the folder picker the attribute every browser picks folders with", () => {
    renderServer();

    expect(
      document.querySelector("#upload-folder")?.hasAttribute("webkitdirectory"),
    ).toBe(true);
  });

  it("uploads a dropped folder, keeping its structure and showing how far it has got, then reconstructs the Assembly it holds", async () => {
    const pending: {
      url: string;
      onProgress: (sent: number) => void;
      resolve: (answer: Answer) => void;
    }[] = [];
    const page = renderServer({
      put: (url, _body, onProgress) =>
        new Promise((resolve) => pending.push({ url, onProgress, resolve })),
    });

    await dropOn([APP_FOLDER]);

    expect(page.requests[0]).toMatchObject({ url: "/api/uploads" });
    expect(JSON.parse(String(page.requests[0]?.init?.body))).toEqual({
      files: [
        { path: "App/App.dll", size: 100 },
        { path: "App/App.runtimeconfig.json", size: 2 },
        { path: "App/libs/Library.dll", size: 50 },
      ],
    });
    expect(uploadStatus()).toBe(
      "Uploading App: 0 B of 152 B (0%), 0 of 3 files",
    );
    // One thing at a time.
    expect(uploadButtons().map((each) => each.disabled)).toEqual([true, true]);
    expect(button().disabled).toBe(true);

    await act(async () => {
      pending[0]?.onProgress(40);
      pending[2]?.onProgress(50);
      pending[2]?.resolve({ status: 204, body: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(uploadStatus()).toBe(
      "Uploading App: 90 B of 152 B (59%), 1 of 3 files",
    );
    expect(
      (
        document.querySelector(
          ".upload-progress progress",
        ) as HTMLProgressElement
      ).value,
    ).toBe(90);

    await act(async () => {
      pending[0]?.onProgress(100);
      pending[0]?.resolve({ status: 204, body: null });
      pending[1]?.resolve({ status: 204, body: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(pending.map(({ url }) => url).toSorted()).toEqual([
      `${FILES}/0`,
      `${FILES}/1`,
      `${FILES}/2`,
    ]);
    expect(page.requests[1]).toMatchObject({ url: "/api/reconstructions" });
    expect(page.requests[1]?.init?.body).toBe(
      JSON.stringify({
        upload: UPLOAD_ID,
        assembly: "App/App.dll",
        siblings: true,
      }),
    );
    expect(page.followed).toEqual([ID]);
    expect(document.querySelector(".upload-progress")).toBeNull();
    const source = page.source();
    act(() => source.open());
    send(source, "started", { path: UPLOADED });
    expect(document.querySelector(".reconstruction h2")?.textContent).toBe(
      `Reconstructing ${UPLOADED}`,
    );
    // The box is for paths the user gives, not the uploaded copy's.
    expect(input().value).toBe("");
    send(source, "ended", {
      kind: "reconstructed",
      directory: "/tmp/xray-ui-a1b2c3/reconstructions/x",
      report,
    } satisfies ReconstructionEnd);
    expect(uploadButtons().map((each) => each.disabled)).toEqual([
      false,
      false,
    ]);
  });

  it("uploads the file chosen with the file picker, by its name, and reconstructs it", async () => {
    const page = renderServer({ assembly: "MyApp.exe" });
    const file = new File(["MZ" + "x".repeat(4094)], "MyApp.exe");

    await pick("upload-file", [file]);

    expect(JSON.parse(String(page.requests[0]?.init?.body))).toEqual({
      files: [{ path: "MyApp.exe", size: 4096 }],
    });
    expect(page.puts).toEqual([{ url: `${FILES}/0`, body: file }]);
    expect(page.requests[1]?.init?.body).toBe(
      JSON.stringify({
        upload: UPLOAD_ID,
        assembly: "MyApp.exe",
        siblings: true,
      }),
    );
    expect(page.followed).toEqual([ID]);
  });

  it("asks which Assembly to reconstruct when the folder chosen does not say, then reconstructs that one", async () => {
    const page = renderServer({ assembly: null });
    const files = ["Libs/One.dll", "Libs/Two.dll"].map((path) => {
      const file = new File(["MZ"], path.split("/")[1] ?? "");
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      return file;
    });

    await pick("upload-folder", files);

    expect(JSON.parse(String(page.requests[0]?.init?.body))).toEqual({
      files: [
        { path: "Libs/One.dll", size: 2 },
        { path: "Libs/Two.dll", size: 2 },
      ],
    });
    const choice = document.querySelector(
      ".assembly-choice",
    ) as HTMLFormElement;
    expect(choice.querySelector("legend")?.textContent).toBe(
      "Libs holds 2 .exe and .dll files. Which is the application to reconstruct?",
    );
    const radios = [
      ...choice.querySelectorAll('input[type="radio"]'),
    ] as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual([
      "App/App.dll",
      "App/libs/Library.dll",
    ]);
    const submit = choice.querySelector("button") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(page.requests).toHaveLength(1);

    act(() => radios[1]?.click());
    await act(async () => submit.click());

    expect(page.requests[1]?.init?.body).toBe(
      JSON.stringify({
        upload: UPLOAD_ID,
        assembly: "App/libs/Library.dll",
        siblings: true,
      }),
    );
    expect(document.querySelector(".assembly-choice")).toBeNull();
    expect(page.followed).toEqual([ID]);
  });

  it("says why an upload was refused, beside where it was dropped, and starts nothing", async () => {
    const message =
      "There is no .exe or .dll among the files given: choose an Assembly, or a folder holding one.";
    const page = renderServer({ uploadAnswer: json(400, { message }) });

    await dropOn([folderEntry("Docs", [fileEntry("a.txt", "a")])]);

    expect(alertText()).toEqual([message]);
    expect(document.querySelector(".upload [role=alert]")?.textContent).toBe(
      message,
    );
    expect(page.puts).toEqual([]);
    expect(page.sources).toEqual([]);
    expect(uploadButtons().map((each) => each.disabled)).toEqual([
      false,
      false,
    ]);
  });

  it("says why a file could not be uploaded, and lets the user try again", async () => {
    const page = renderServer({
      put: async () => ({
        status: 400,
        body: { message: '"App/App.dll" is 100 bytes, but 99 were sent.' },
      }),
    });

    await dropOn([APP_FOLDER]);

    expect(alertText()).toEqual([
      '"App/App.dll" is 100 bytes, but 99 were sent.',
    ]);
    expect(page.sources).toEqual([]);
    expect(document.querySelector(".upload-progress")).toBeNull();
    expect(uploadButtons().map((each) => each.disabled)).toEqual([
      false,
      false,
    ]);
  });

  it("refuses more than one thing dropped at a time, sending nothing", async () => {
    const page = renderServer();

    await dropOn([fileEntry("a.dll", "MZ"), fileEntry("b.dll", "MZ")]);

    expect(alertText()).toEqual([
      "Choose one Assembly, or one folder holding one, at a time.",
    ]);
    expect(page.requests).toEqual([]);
  });

  it("keeps a file dropped anywhere else on the page from replacing it", () => {
    renderServer();
    const drop = new Event("drop", { cancelable: true });

    window.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
  });
});

describe("App, browsing the Recovered Solution", () => {
  /** Lets every answer already given arrive, and the page show it. */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  /** Reconstructs the arithmetic Fixture to a Full Reconstruction, and lets the page list its files. */
  async function reconstructed(page: Rendered): Promise<void> {
    await reconstruct(PATH);
    send(page.source(), "started", { path: PATH });
    send(page.source(), "ended", {
      kind: "reconstructed",
      directory: `/tmp/xray-ui-abc123/reconstructions/${ID}`,
      report,
    } satisfies ReconstructionEnd);
    await settle();
  }

  function explorer(): HTMLElement | null {
    return document.querySelector('section[aria-label="Recovered Solution"]');
  }

  /** Each folder and file in the tree, in order, a folder with its name and whether it is open. */
  function tree(): string[] {
    return [
      ...document.querySelectorAll<HTMLButtonElement>(".file-tree button"),
    ].map((button) =>
      button.hasAttribute("aria-expanded")
        ? `${button.textContent ?? ""}/ ${button.getAttribute("aria-expanded") === "true" ? "open" : "closed"}`
        : (button.textContent ?? ""),
    );
  }

  function fileButton(name: string): HTMLButtonElement {
    const found = [
      ...document.querySelectorAll<HTMLButtonElement>(".tree-file > button"),
    ].find((button) => button.textContent === name);
    expect(found, name).toBeDefined();
    return found as HTMLButtonElement;
  }

  async function choose(name: string): Promise<void> {
    await act(async () => {
      fileButton(name).click();
    });
    await settle();
  }

  function viewerElement(): HTMLElement {
    return document.querySelector(".code-viewer") as HTMLElement;
  }

  it("lists every file of the Recovered Solution once it is written, each folder's folders then its files, all open", async () => {
    const page = render();
    await reconstruct(PATH);
    send(page.source(), "started", { path: PATH });

    // Nothing to browse while it runs.
    expect(explorer()).toBeNull();
    send(page.source(), "ended", {
      kind: "reconstructed",
      directory: `/tmp/xray-ui-abc123/reconstructions/${ID}`,
      report,
    } satisfies ReconstructionEnd);
    await settle();

    expect(page.requests.map((request) => request.url)).toContain(FILES);
    expect(explorer()?.querySelector("h2")?.textContent).toBe(
      "Recovered Solution Arithmetic.sln",
    );
    expect(document.querySelector(".file-count")?.textContent).toBe("5 files");
    expect(tree()).toEqual([
      "Arithmetic/ open",
      "Properties/ open",
      "AssemblyInfo.cs",
      "Arithmetic.csproj",
      "Program.cs",
      "Arithmetic.sln",
      "xray-report.json",
    ]);
    expect(fileButton("Program.cs").title).toBe(
      `Arithmetic/Program.cs, ${new TextEncoder().encode(SOLUTION["Arithmetic/Program.cs"]).length} bytes`,
    );
    expect(fileButton("Program.cs").dataset.language).toBe("csharp");
    expect(fileButton("Arithmetic.csproj").dataset.language).toBe("xml");
    expect(fileButton("Arithmetic.sln").dataset.language).toBe("sln");
    expect(fileButton("xray-report.json").dataset.language).toBe("plaintext");
    expect(explorer()?.textContent).toContain("Choose a file to read it.");
    expect(alertText()).toEqual([]);
  });

  it("offers to download the Recovered Solution as a zip once it is written, with a link the browser saves, asking the server for nothing until it is chosen", async () => {
    const page = render();
    await reconstruct(PATH);
    send(page.source(), "started", { path: PATH });

    // Nothing to download while it runs.
    expect(document.querySelector(".download-button")).toBeNull();
    send(page.source(), "ended", {
      kind: "reconstructed",
      directory: `/tmp/xray-ui-abc123/reconstructions/${ID}`,
      report,
    } satisfies ReconstructionEnd);
    await settle();

    const download =
      explorer()?.querySelector<HTMLAnchorElement>("a.download-button");
    expect(download?.textContent).toBe("Download .zip");
    expect(download?.getAttribute("href")).toBe(
      `/api/reconstructions/${ID}/zip`,
    );
    // Saved, by the name the server gives it, rather than opened.
    expect(download?.getAttribute("download")).toBe("");
    expect(download?.parentElement?.textContent).toContain(
      "Its files, in a folder of their own, to build with dotnet build: not what that made in bin/ and obj/.",
    );
    expect(
      page.requests.filter((request) => request.url.endsWith("/zip")),
    ).toEqual([]);
  });

  it("offers the download even when the files could not be listed", async () => {
    const page = render({
      files: async () => json(500, { message: "Something went wrong." }),
    });
    await reconstructed(page);

    expect(
      document.querySelector("a.download-button")?.getAttribute("href"),
    ).toBe(`/api/reconstructions/${ID}/zip`);
  });

  it("shows every file chosen in the read-only viewer, exactly as the server sent it, one viewer for all of them", async () => {
    const viewer = fakeViewer();
    const page = render({ viewer });
    await reconstructed(page);

    for (const [path, text] of Object.entries(SOLUTION)) {
      const name = path.split("/").at(-1) ?? path;
      await choose(name);

      expect(viewer.shown.at(-1)).toEqual({ path, text });
      expect(page.requests.at(-1)?.url).toBe(
        `${FILES}/${path.split("/").map(encodeURIComponent).join("/")}`,
      );
      expect(document.querySelector(".file-pane-header")?.textContent).toBe(
        `${path} ${new TextEncoder().encode(text).length} bytes`,
      );
      expect(fileButton(name).getAttribute("aria-current")).toBe("true");
      expect(
        document.querySelectorAll('.file-tree [aria-current="true"]'),
      ).toHaveLength(1);
      expect(viewerElement().hidden).toBe(false);
      expect(viewerElement().dataset.path).toBe(path);
    }
    expect(viewer.shown.map((file) => file.path)).toEqual(
      Object.keys(SOLUTION),
    );
    expect(viewer.hosts).toEqual([viewerElement()]);
    expect(alertText()).toEqual([]);
  });

  it("does not read a binary copied into Dependencies, nor show it as text, saying why", async () => {
    const viewer = fakeViewer();
    const binary = "Dependencies/Kestrelwood.Checksums.dll";
    const page = render({
      viewer,
      files: async (url) =>
        url === FILES
          ? json(200, {
              files: [
                ...Object.entries(SOLUTION).map(([path, text]) => ({
                  path,
                  size: new TextEncoder().encode(text).length,
                })),
                { path: binary, size: 8_192 },
              ],
            })
          : solutionAnswer(url),
    });
    await reconstructed(page);
    await choose("Program.cs");

    await choose("Kestrelwood.Checksums.dll");

    expect(
      page.requests.filter((request) => request.url.includes("Dependencies")),
    ).toEqual([]);
    expect(document.querySelector(".file-pane-header")?.textContent).toBe(
      `${binary} 8.0 KiB`,
    );
    expect(document.querySelector(".file-binary")?.textContent).toBe(
      "A binary, copied into the Recovered Solution as it was found beside the input, so it is not shown here. It is in the .zip.",
    );
    expect(viewerElement().hidden).toBe(true);
    expect(viewer.shown.map(({ path }) => path)).toEqual([
      "Arithmetic/Program.cs",
    ]);
    expect(
      fileButton("Kestrelwood.Checksums.dll").getAttribute("aria-current"),
    ).toBe("true");
    expect(alertText()).toEqual([]);
  });

  it("shows a large file in the viewer, which draws only the lines in view, never writing its text into the page", async () => {
    const line = "    public static int Add(int a, int b) => a + b;\n";
    const large = line.repeat(Math.ceil((32 * 1024 * 1024) / line.length));
    const viewer = fakeViewer();
    const page = render({
      viewer,
      files: async (url) =>
        url === FILES
          ? json(200, {
              files: [{ path: "Arithmetic/Large.cs", size: large.length }],
            })
          : new Response(large, { status: 200 }),
    });
    await reconstructed(page);

    await choose("Large.cs");

    expect(viewer.shown).toEqual([
      { path: "Arithmetic/Large.cs", text: large },
    ]);
    expect(document.querySelector(".file-pane-header")?.textContent).toBe(
      "Arithmetic/Large.cs 32.0 MiB",
    );
    expect(document.body.innerHTML.length).toBeLessThan(20_000);
  });

  it("shows only the last file chosen when another is chosen before the first arrives, no longer reading the first", async () => {
    const viewer = fakeViewer();
    const signals: AbortSignal[] = [];
    const page = render({
      viewer,
      files: (url, init) => {
        if (url.endsWith("/Program.cs")) {
          // It never arrives, until it is no longer wanted.
          if (init?.signal) {
            signals.push(init.signal);
          }
          return new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          );
        }
        return solutionAnswer(url);
      },
    });
    await reconstructed(page);

    await choose("Program.cs");
    expect(explorer()?.querySelector('[role="status"]')?.textContent).toBe(
      "Opening Arithmetic/Program.cs…",
    );
    expect(viewerElement().hidden).toBe(true);
    await choose("Arithmetic.sln");

    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    expect(viewer.shown).toEqual([
      { path: "Arithmetic.sln", text: SOLUTION["Arithmetic.sln"] },
    ]);
    expect(fileButton("Arithmetic.sln").getAttribute("aria-current")).toBe(
      "true",
    );
    expect(fileButton("Program.cs").hasAttribute("aria-current")).toBe(false);
    expect(explorer()?.querySelector('[role="status"]')).toBeNull();
  });

  it("closes a folder, hiding what it holds, and opens it again", async () => {
    const page = render();
    await reconstructed(page);
    const arithmetic = document.querySelector(
      ".tree-folder > button",
    ) as HTMLButtonElement;

    act(() => arithmetic.click());
    expect(tree()).toEqual([
      "Arithmetic/ closed",
      "Arithmetic.sln",
      "xray-report.json",
    ]);
    act(() => arithmetic.click());
    expect(tree()).toHaveLength(7);
  });

  it("says why a file could not be opened, showing nothing in the viewer", async () => {
    const message =
      'There is no file "Arithmetic/Program.cs" in the Recovered Solution.';
    const viewer = fakeViewer();
    const page = render({
      viewer,
      files: async (url) =>
        url.endsWith("/Program.cs")
          ? json(404, { message })
          : solutionAnswer(url),
    });
    await reconstructed(page);

    await choose("Program.cs");

    expect(alertText()).toEqual([message]);
    expect(viewer.shown).toEqual([]);
    expect(viewerElement().hidden).toBe(true);
  });

  it("says why the files could not be listed", async () => {
    const message =
      "The Reconstruction wrote no Recovered Solution, so there are no files to browse or download.";
    const page = render({ files: async () => json(404, { message }) });
    await reconstructed(page);

    expect(alertText()).toEqual([message]);
    expect(document.querySelector(".file-tree")).toBeNull();
  });

  it("says so if the code viewer cannot be loaded", async () => {
    const page = render({
      viewer: {
        ...fakeViewer(),
        createViewer: () => Promise.reject(new Error("Failed to fetch")),
      },
    });
    await reconstructed(page);

    await choose("Program.cs");

    expect(alertText()).toEqual([
      "The code viewer could not be loaded: Failed to fetch. Reload the page to try again.",
    ]);
  });

  it("offers nothing to browse when the Reconstruction wrote no Recovered Solution, asking the server for none", async () => {
    const page = render();
    await reconstruct("/fixtures/native/hello.exe");
    send(page.source(), "ended", {
      kind: "rejected",
      inputKind: "native-executable",
      explanation: '"hello.exe" is a Native Executable.',
    } satisfies ReconstructionEnd);
    await settle();

    expect(explorer()).toBeNull();
    expect(document.querySelector(".download-button")).toBeNull();
    expect(
      page.requests.filter((request) => request.url.startsWith(FILES)),
    ).toEqual([]);
  });

  it("removes the viewer from the page once it no longer shows the Recovered Solution", async () => {
    const viewer = fakeViewer();
    const page = render({ viewer });
    await reconstructed(page);
    await choose("Program.cs");

    act(() => root?.unmount());
    root = undefined;

    expect(viewer.disposed()).toBe(1);
    expect(page.requests.length).toBeGreaterThan(0);
  });
});

describe("App, the report", () => {
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  async function ended(page: Rendered, summary: ReportSummary): Promise<void> {
    await reconstruct(PATH);
    send(page.source(), "started", { path: PATH });
    send(page.source(), "inspected", ARITHMETIC);
    send(page.source(), "ended", {
      kind: "reconstructed",
      directory: `/tmp/xray-ui-abc123/reconstructions/${ID}`,
      report: summary,
    } satisfies ReconstructionEnd);
    await settle();
  }

  function panel(): HTMLElement {
    return document.querySelector(
      'section[aria-label="Report"]',
    ) as HTMLElement;
  }

  /** Each diagnostic listed, as its text, and whether choosing it opens its file. */
  function diagnostics(): string[] {
    return [...panel().querySelectorAll(".diagnostics li")].map(
      (item) =>
        `${item.querySelector("button") === null ? "-" : ">"} ${item.textContent ?? ""}`,
    );
  }

  async function chooseDiagnostic(index: number): Promise<void> {
    const item = panel().querySelectorAll(".diagnostics li")[index];
    const choice = item?.querySelector("button");
    expect(choice, `diagnostic ${index}`).toBeTruthy();
    await act(async () => {
      choice?.click();
    });
    await settle();
  }

  function chosenInTree(): string[] {
    return [
      ...document.querySelectorAll<HTMLButtonElement>(
        '.file-tree [aria-current="true"]',
      ),
    ].map((button) => button.textContent ?? "");
  }

  /** The arithmetic Fixture's Recovered Solution, as if it had not built. */
  const PROGRAM_CS = "Arithmetic/Program.cs";
  const ASSEMBLY_INFO = "Arithmetic/Properties/AssemblyInfo.cs";
  const partial: ReportSummary = {
    ...report,
    outcome: "partial",
    reasons: [
      {
        kind: "build-failed",
        errors: [
          {
            severity: "error",
            code: "CS0246",
            message:
              "The type or namespace name 'Program' could not be found (are you missing a using directive or an assembly reference?)",
            file: PROGRAM_CS,
            line: 1,
            column: 16,
          },
          {
            severity: "error",
            code: "CS0103",
            message: "The name 'args' does not exist in the current context",
            file: PROGRAM_CS,
            line: 3,
            column: 33,
          },
          {
            severity: "error",
            code: "CS0518",
            message:
              "Predefined type 'System.Object' is not defined or imported",
            file: ASSEMBLY_INFO,
            line: 1,
            column: 12,
          },
          {
            severity: "error",
            code: "MSB4018",
            message: 'The "ResolvePackageAssets" task failed unexpectedly.',
            file: "/usr/share/dotnet/sdk/8.0.100/Microsoft.PackageDependencyResolution.targets",
            line: 266,
            column: 5,
          },
          {
            severity: "error",
            code: "MSB1009",
            message: "Project file does not exist.",
          },
        ],
      },
    ],
    build: {
      succeeded: false,
      diagnostics: [
        {
          severity: "warning",
          code: "NU1603",
          message: "A package was resolved to a version it did not ask for.",
          file: "Arithmetic/Arithmetic.csproj",
        },
        {
          severity: "error",
          code: "CS0246",
          message:
            "The type or namespace name 'Program' could not be found (are you missing a using directive or an assembly reference?)",
          file: PROGRAM_CS,
          line: 1,
          column: 16,
        },
        {
          severity: "error",
          code: "CS0103",
          message: "The name 'args' does not exist in the current context",
          file: PROGRAM_CS,
          line: 3,
          column: 33,
        },
        {
          severity: "error",
          code: "CS0518",
          message: "Predefined type 'System.Object' is not defined or imported",
          file: ASSEMBLY_INFO,
          line: 1,
          column: 12,
        },
        {
          severity: "error",
          code: "MSB4018",
          message: 'The "ResolvePackageAssets" task failed unexpectedly.',
          file: "/usr/share/dotnet/sdk/8.0.100/Microsoft.PackageDependencyResolution.targets",
          line: 266,
          column: 5,
        },
        {
          severity: "error",
          code: "MSB1009",
          message: "Project file does not exist.",
        },
      ],
    },
  };

  it("shows a Full Reconstruction as plainly a success: the outcome, how it built, how long each stage took, and no diagnostic", async () => {
    const page = render();
    await ended(page, report);

    const outcome = panel().querySelector(".outcome") as HTMLElement;
    expect(panel().querySelector("h2")?.textContent).toBe(
      "Report xray-report.json",
    );
    expect(outcome.dataset.outcome).toBe("full");
    expect(outcome.getAttribute("role")).toBe("status");
    expect(outcome.querySelector("h3")?.textContent).toBe(
      "Full Reconstruction",
    );
    expect(outcome.querySelector("p")?.textContent).toBe(
      "The Recovered Solution builds.",
    );
    expect(
      [...outcome.querySelectorAll(".facts div")].map((fact) => [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ]),
    ).toContainEqual(["Build", "succeeded"]);
    expect(
      [...panel().querySelectorAll(".timings tr")].map((row) => [
        row.querySelector("th")?.textContent,
        row.querySelector("td")?.textContent,
      ]),
    ).toEqual([
      ["Analyse", "93 ms"],
      ["Decompile", "1.6 s"],
      ["Resolve dependencies", "12 ms"],
      ["Generate solution", "5 ms"],
      ["Build", "2.6 s"],
      ["Run the rebuilt program", "not run"],
      ["Total", "4.3 s"],
    ]);
    expect(panel().querySelector(".diagnostics-none")?.textContent).toBe(
      "None: dotnet build reported no error or warning.",
    );
    expect(panel().querySelector(".diagnostics")).toBeNull();
    // Nothing that reads as a failure.
    expect(alertText()).toEqual([]);
    expect(panel().textContent).not.toMatch(/Partial|fail/i);
    // Shown just below the progress, and above the inspect summary and the
    // Recovered Solution its diagnostics open.
    expect(
      [...document.querySelectorAll(".shell-main > section")].map((section) =>
        section.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Upload",
      "Reconstruction progress",
      "Report",
      "Inspect summary",
      "Recovered Solution",
    ]);
  });

  it("shows how Dependency Resolution satisfied every reference, in a table, and counts each way", async () => {
    const page = render();
    const identity = (name: string, publicKeyToken: string | null = null) => ({
      name,
      version: "1.0.0.0",
      culture: null,
      publicKeyToken,
    });
    const none = { package: null, projectPath: null, copiedTo: null };

    await ended(page, {
      ...report,
      dependencies: [
        ...report.dependencies,
        {
          ...none,
          reference: identity("Serilog", "24c2f752a8e58a10"),
          referencedBy: ["Arithmetic", "Pricing"],
          resolution: "nuget-package",
          package: { id: "Serilog", version: "3.1.1" },
          reason: "Serilog 3.1.1 holds it.",
        },
        {
          ...none,
          reference: identity("Pricing"),
          referencedBy: ["Arithmetic"],
          resolution: "sibling-assembly",
          projectPath: "Pricing/Pricing.csproj",
          reason: "It is the application's own.",
        },
        {
          ...none,
          reference: identity("Kestrelwood.Checksums", "51ca75d1f3633191"),
          referencedBy: ["Arithmetic"],
          resolution: "copied-binary",
          copiedTo: "Dependencies/Kestrelwood.Checksums.dll",
          reason: "It is a third party's.",
        },
      ],
    });

    const table = panel().querySelector("table.dependencies") as HTMLElement;
    // In a region that scrolls, and can be scrolled from the keyboard.
    const region = table.parentElement as HTMLElement;
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBe("Dependency Resolution");
    expect(region.tabIndex).toBe(0);
    expect(region.previousElementSibling?.textContent).toBe(
      "Dependency Resolution",
    );
    expect(
      [...table.querySelectorAll("thead th")].map((th) => th.textContent),
    ).toEqual([
      "Reference",
      "Resolution",
      "In the Recovered Solution",
      "Referenced by",
      "Why",
    ]);
    expect(
      [...table.querySelectorAll("tbody tr")].map((row) => [
        (row as HTMLElement).dataset.resolution,
        ...[...row.querySelectorAll("th, td")].map((cell) => cell.textContent),
      ]),
    ).toEqual([
      [
        "framework",
        "System.Console 8.0.0.0, b03f5f7f11d50a3a",
        "Framework",
        "—",
        "Arithmetic",
        "System.Console is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), so it is the framework's, or one of Microsoft's own packages, and is left to the target framework.",
      ],
      [
        "framework",
        "System.Runtime 8.0.0.0, b03f5f7f11d50a3a",
        "Framework",
        "—",
        "Arithmetic",
        "System.Runtime is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), so it is the framework's, or one of Microsoft's own packages, and is left to the target framework.",
      ],
      [
        "nuget-package",
        "Serilog 1.0.0.0, 24c2f752a8e58a10",
        "NuGet package",
        "Serilog 3.1.1",
        "Arithmetic, Pricing",
        "Serilog 3.1.1 holds it.",
      ],
      [
        "sibling-assembly",
        "Pricing 1.0.0.0",
        "Sibling Assembly",
        "Pricing/Pricing.csproj",
        "Arithmetic",
        "It is the application's own.",
      ],
      [
        "copied-binary",
        "Kestrelwood.Checksums 1.0.0.0, 51ca75d1f3633191",
        "Copied binary",
        "Dependencies/Kestrelwood.Checksums.dll",
        "Arithmetic",
        "It is a third party's.",
      ],
    ]);
    expect(
      [...panel().querySelectorAll(".facts div")].map((fact) => [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ]),
    ).toContainEqual([
      "Dependencies",
      "5 references: 2 framework, 1 NuGet package, 1 Sibling Assembly, 1 copied binary",
    ]);
    // Nothing unresolved, so nothing reads as a failure.
    expect(panel().querySelector(".unresolved")).toBeNull();
    expect(panel().textContent).not.toMatch(/Partial|Unresolved/);
  });

  it("names each Unresolved Dependency as why a Partial Reconstruction is Partial, before its build errors, and marks it in the table", async () => {
    const page = render();
    const unresolved = (name: string) => ({
      reference: {
        name,
        version: "1.0.0.0",
        culture: null,
        publicKeyToken: null,
      },
      referencedBy: ["Arithmetic"],
      resolution: "unresolved",
      package: null,
      projectPath: null,
      copiedTo: null,
      reason: `No Managed Assembly named ${name} is beside the input to reconstruct or copy, so nothing satisfies it.`,
    });
    const greetings = unresolved("Greetings");
    const ledger = unresolved("Ledger");
    const errors = [
      {
        severity: "error" as const,
        code: "CS0246",
        message:
          "The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)",
        file: PROGRAM_CS,
        line: 2,
        column: 7,
      },
    ];

    await ended(page, {
      ...report,
      outcome: "partial",
      reasons: [
        { kind: "unresolved-dependencies", dependencies: [greetings, ledger] },
        { kind: "build-failed", errors },
      ],
      dependencies: [greetings, ...report.dependencies, ledger],
      build: { succeeded: false, diagnostics: errors },
    });

    const outcome = panel().querySelector(".outcome") as HTMLElement;
    expect(outcome.dataset.outcome).toBe("partial");
    expect(outcome.querySelector("p")?.textContent).toBe(
      "The Recovered Solution was written, but falls short of a Full Reconstruction, for the reasons below.",
    );
    expect(
      [...outcome.querySelectorAll(":scope > p")]
        .slice(1)
        .map((reason) => reason.textContent),
    ).toEqual([
      "Partial, because nothing satisfies these 2 references, each an Unresolved Dependency: Greetings, Ledger. The table below says why.",
      "Partial, because the Recovered Solution did not build, with 1 error, listed below at its file and line.",
    ]);
    expect(
      [
        ...panel().querySelectorAll(
          '.dependencies tr[data-resolution="unresolved"]',
        ),
      ].map((row) => row.querySelector("td")?.textContent),
    ).toEqual(["Unresolved", "Unresolved"]);
    expect(
      [...panel().querySelectorAll(".facts div")].map((fact) => [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ]),
    ).toContainEqual([
      "Dependencies",
      "4 references: 2 framework, 2 unresolved",
    ]);
  });

  it("names a single Unresolved Dependency of a Reconstruction that was not built", async () => {
    const page = render();
    const greetings = {
      reference: {
        name: "Greetings",
        version: "1.0.0.0",
        culture: null,
        publicKeyToken: null,
      },
      referencedBy: ["Arithmetic"],
      resolution: "unresolved",
      package: null,
      projectPath: null,
      copiedTo: null,
      reason: "Nothing satisfies it.",
    };

    await ended(page, {
      ...report,
      outcome: "partial",
      reasons: [{ kind: "unresolved-dependencies", dependencies: [greetings] }],
      dependencies: [greetings],
      build: null,
    });

    expect(panel().querySelector(".unresolved")?.textContent).toBe(
      "Partial, because nothing satisfies this reference, an Unresolved Dependency: Greetings. The table below says why.",
    );
  });

  it("lists the project of each Sibling Assembly, what it references, and what was worked around in them", async () => {
    const page = render();
    const library = (
      name: string,
      typeCount: number,
      projectReferences: string[] = [],
    ) => ({
      assemblyName: name,
      projectPath: `${name}/${name}.csproj`,
      typeCount,
      pdb: { status: "none" },
      obfuscation: { status: "clean", indicators: [] },
      projectReferences,
      resources: [],
    });
    const message =
      "2 Assemblies beside the input are named Inventory: /app/Inventory.dll, /app/Inventory.exe. Only /app/Inventory.dll is reconstructed, as the runtime would load it.";

    await ended(page, {
      ...report,
      solution: {
        ...report.solution,
        projects: [
          ...report.solution.projects,
          library("Inventory", 1),
          library("Pricing", 8, ["Inventory/Inventory.csproj"]),
        ],
      },
      siblingProblems: [{ kind: "duplicate-assembly-name", message }],
    });

    expect(
      [...panel().querySelectorAll(".facts div")].map((fact) => [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ]),
    ).toContainEqual(["Sibling Assemblies", "2, each a project of its own"]);
    expect(
      [...panel().querySelectorAll(".sibling-projects li")].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      "Inventory/Inventory.csproj, 1 type",
      "Pricing/Pricing.csproj, 8 types, referencing Inventory/Inventory.csproj",
    ]);
    expect(
      [...panel().querySelectorAll(".sibling-problems li")].map(
        (item) => item.textContent,
      ),
    ).toEqual([message]);
  });

  it("says which PDB the Assembly was decompiled with, how many files its types are in, and lists each warning", async () => {
    const page = render();
    const message =
      "Ignored the PDB beside Inventory.dll, /app/Inventory.pdb. Inventory.pdb, a portable PDB, is not Inventory.dll's own: its ID is not the one Inventory.dll records, so it is another build's. So Inventory's local variables are named, and its source files laid out, as without a PDB.";

    await ended(page, {
      ...report,
      solution: {
        ...report.solution,
        typeCount: 3,
        sourceFileCount: 2,
        projects: [
          {
            ...(report.solution
              .projects[0] as ReportSummary["solution"]["projects"][number]),
            typeCount: 3,
            pdb: {
              status: "matching",
              path: "/app/Arithmetic.pdb",
              format: "portable",
            },
          },
        ],
      },
      warnings: [{ kind: "pdb-ignored", message }],
    });

    const facts = [...panel().querySelectorAll(".facts div")].map((fact) => [
      fact.querySelector("dt")?.textContent,
      fact.querySelector("dd")?.textContent,
    ]);
    expect(facts).toContainEqual(["Types", "3, decompiled to 2 files"]);
    expect(facts).toContainEqual([
      "PDB",
      "/app/Arithmetic.pdb, used for local names and source layout",
    ]);
    expect(
      [...panel().querySelectorAll(".warnings li")].map((item) => [
        (item as HTMLElement).dataset.kind,
        item.textContent,
      ]),
    ).toEqual([["pdb-ignored", message]]);
  });

  it("says the Assembly is likely obfuscated, and how, and lists the warning that it was reconstructed as it is", async () => {
    const page = render();
    const message =
      "Obfuscated.dll is likely obfuscated. 79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer. It was reconstructed as it is, not deobfuscated: Obfuscated's names and strings are the obfuscator's.";

    await ended(page, {
      ...report,
      solution: {
        ...report.solution,
        projects: [
          {
            ...(report.solution
              .projects[0] as ReportSummary["solution"]["projects"][number]),
            obfuscation: {
              status: "obfuscated",
              indicators: [
                {
                  kind: "mangled-identifiers",
                  evidence: [],
                  message: "79 of its 81 names …",
                },
                {
                  kind: "encrypted-strings",
                  evidence: [],
                  message: "Its strings are hidden: …",
                },
              ],
            },
          },
        ],
      },
      warnings: [{ kind: "obfuscated", message }],
    });

    const facts = [...panel().querySelectorAll(".facts div")].map((fact) => [
      fact.querySelector("dt")?.textContent,
      fact.querySelector("dd")?.textContent,
    ]);
    expect(facts).toContainEqual([
      "Obfuscation",
      "likely obfuscated (mangled names, hidden strings): reconstructed as it is, not deobfuscated",
    ]);
    expect(
      [...panel().querySelectorAll(".warnings li")].map((item) => [
        (item as HTMLElement).dataset.kind,
        item.textContent,
      ]),
    ).toEqual([["obfuscated", message]]);
  });

  it("lists no warnings when there are none", async () => {
    const page = render();

    await ended(page, report);

    expect(panel().querySelector(".warnings")).toBeNull();
  });

  it("says when Sibling Assemblies were turned off, and lists none when there are none", async () => {
    const page = render();

    await ended(page, {
      ...report,
      inputs: { options: { siblings: false } },
    });

    expect(
      [...panel().querySelectorAll(".facts div")].map((fact) => [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ]),
    ).toContainEqual(["Sibling Assemblies", "not reconstructed (turned off)"]);
    expect(panel().querySelector(".sibling-projects")).toBeNull();
    expect(panel().querySelector(".sibling-problems")).toBeNull();
  });

  it("lists a Full Reconstruction's warnings, each opening its file at its line", async () => {
    const viewer = fakeViewer();
    const page = render({ viewer });
    await ended(page, {
      ...report,
      build: {
        succeeded: true,
        diagnostics: [
          {
            severity: "warning",
            code: "CS0168",
            message: "The variable 'e' is declared but never used",
            file: PROGRAM_CS,
            line: 5,
            column: 3,
          },
        ],
      },
    });

    expect(
      panel().querySelector(".outcome")?.getAttribute("data-outcome"),
    ).toBe("full");
    expect(
      [...panel().querySelectorAll(".facts div")].map(
        (fact) => fact.textContent,
      ),
    ).toContain("Buildsucceeded with 1 warning");
    expect(diagnostics()).toEqual([
      "> Arithmetic/Program.cs:5:3: warning CS0168: The variable 'e' is declared but never used",
    ]);
    await chooseDiagnostic(0);
    expect(viewer.shown.at(-1)).toEqual({
      path: PROGRAM_CS,
      text: SOLUTION[PROGRAM_CS],
      at: { line: 5, column: 3 },
    });
  });

  it("navigates each of a Partial Reconstruction's diagnostics in the Recovered Solution to its file and line, in the viewer", async () => {
    const viewer = fakeViewer();
    const scrolled: Element[] = [];
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const page = render({ viewer });
      await ended(page, partial);

      const outcome = panel().querySelector(".outcome") as HTMLElement;
      expect(outcome.dataset.outcome).toBe("partial");
      expect(outcome.querySelector("h3")?.textContent).toBe(
        "Partial Reconstruction",
      );
      expect(
        [...outcome.querySelectorAll(".facts div")].map(
          (fact) => fact.textContent,
        ),
      ).toContain("Buildfailed with 5 errors and 1 warning");
      // The errors, then the warning; only those about a file of the
      // Recovered Solution open one.
      expect(diagnostics()).toEqual([
        "> Arithmetic/Program.cs:1:16: error CS0246: The type or namespace name 'Program' could not be found (are you missing a using directive or an assembly reference?)",
        "> Arithmetic/Program.cs:3:33: error CS0103: The name 'args' does not exist in the current context",
        "> Arithmetic/Properties/AssemblyInfo.cs:1:12: error CS0518: Predefined type 'System.Object' is not defined or imported",
        '- /usr/share/dotnet/sdk/8.0.100/Microsoft.PackageDependencyResolution.targets:266:5: error MSB4018: The "ResolvePackageAssets" task failed unexpectedly.',
        "- error MSB1009: Project file does not exist.",
        "> Arithmetic/Arithmetic.csproj: warning NU1603: A package was resolved to a version it did not ask for.",
      ]);
      expect(panel().textContent).toContain(
        "5 errors and 1 warning, errors first. Choose one to open its file at its line.",
      );
      expect(viewer.shown).toEqual([]);

      const expected = [
        { index: 0, path: PROGRAM_CS, at: { line: 1, column: 16 } },
        { index: 1, path: PROGRAM_CS, at: { line: 3, column: 33 } },
        { index: 2, path: ASSEMBLY_INFO, at: { line: 1, column: 12 } },
        { index: 5, path: "Arithmetic/Arithmetic.csproj", at: undefined },
      ];
      for (const { index, path, at } of expected) {
        await chooseDiagnostic(index);

        expect(viewer.shown.at(-1), path).toEqual({
          path,
          text: SOLUTION[path],
          ...(at === undefined ? {} : { at }),
        });
        expect(chosenInTree()).toEqual([path.split("/").at(-1)]);
        const viewerElement = document.querySelector(
          ".code-viewer",
        ) as HTMLElement;
        expect(viewerElement.hidden).toBe(false);
        expect(viewerElement.dataset.path).toBe(path);
        expect(document.querySelector(".file-pane-header")?.textContent).toBe(
          `${path} ${new TextEncoder().encode(SOLUTION[path]).length} bytes${at === undefined ? "" : ` line ${at.line}, column ${at.column}`}`,
        );
        // Brought into view.
        expect(scrolled.at(-1)).toBe(document.querySelector(".explorer-panes"));
      }
      expect(viewer.hosts).toHaveLength(1);
      expect(alertText()).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = scrollIntoView;
    }
  });

  it("moves to a diagnostic's line in the file already shown, without reading it again, and again when it is chosen again", async () => {
    const viewer = fakeViewer();
    const page = render({ viewer });
    await ended(page, partial);
    const reads = () =>
      page.requests.filter((request) => request.url.startsWith(`${FILES}/`))
        .length;

    await chooseDiagnostic(0);
    expect(reads()).toBe(1);
    await chooseDiagnostic(1);
    await chooseDiagnostic(1);

    expect(reads()).toBe(1);
    expect(viewer.shown).toEqual([
      {
        path: PROGRAM_CS,
        text: SOLUTION[PROGRAM_CS],
        at: { line: 1, column: 16 },
      },
      {
        path: PROGRAM_CS,
        text: SOLUTION[PROGRAM_CS],
        at: { line: 3, column: 33 },
      },
      {
        path: PROGRAM_CS,
        text: SOLUTION[PROGRAM_CS],
        at: { line: 3, column: 33 },
      },
    ]);

    // A file chosen in the tree opens at its top.
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".tree-file > button")]
        .find((button) => button.textContent === "Arithmetic.sln")
        ?.click();
    });
    await settle();
    expect(viewer.shown.at(-1)).toEqual({
      path: "Arithmetic.sln",
      text: SOLUTION["Arithmetic.sln"],
    });
  });

  it("shows the file already shown from its top for a diagnostic that gives no line", async () => {
    const viewer = fakeViewer();
    const page = render({ viewer });
    const noLine = {
      severity: "warning" as const,
      code: "CS1591",
      message: "Missing XML comment.",
      file: PROGRAM_CS,
    };
    await ended(page, {
      ...partial,
      build: {
        succeeded: false,
        diagnostics: [...(partial.build?.diagnostics ?? []), noLine],
      },
    });

    await chooseDiagnostic(1);
    await chooseDiagnostic(6);

    expect(viewer.shown.slice(-2)).toEqual([
      {
        path: PROGRAM_CS,
        text: SOLUTION[PROGRAM_CS],
        at: { line: 3, column: 33 },
      },
      { path: PROGRAM_CS, text: SOLUTION[PROGRAM_CS] },
    ]);
    expect(document.querySelector(".file-at")).toBeNull();
  });

  it("opens the folders a diagnostic's file is in, when they are closed", async () => {
    const viewer = fakeViewer();
    const page = render({ viewer });
    await ended(page, partial);
    const folders = () => [
      ...document.querySelectorAll<HTMLButtonElement>(".tree-folder > button"),
    ];
    act(() => folders()[0]?.click());
    expect(
      folders().map((folder) => folder.getAttribute("aria-expanded")),
    ).toEqual(["false"]);

    await chooseDiagnostic(2);

    expect(
      folders().map((folder) => folder.getAttribute("aria-expanded")),
    ).toEqual(["true", "true"]);
    expect(chosenInTree()).toEqual(["AssemblyInfo.cs"]);
    expect(viewer.shown.at(-1)?.path).toBe(ASSEMBLY_INFO);
  });

  it("opens a diagnostic chosen before the Recovered Solution's files are listed, once they are", async () => {
    const viewer = fakeViewer();
    let list: () => void = () => undefined;
    const page = render({
      viewer,
      files: (url) =>
        url === FILES
          ? new Promise((resolve) => {
              list = () => resolve(solutionAnswer(url));
            })
          : solutionAnswer(url),
    });
    await ended(page, partial);
    expect(document.querySelector(".file-tree")).toBeNull();

    await chooseDiagnostic(1);
    expect(viewer.shown).toEqual([]);
    list();
    await settle();

    expect(viewer.shown).toEqual([
      {
        path: PROGRAM_CS,
        text: SOLUTION[PROGRAM_CS],
        at: { line: 3, column: 33 },
      },
    ]);
  });

  it("shows no report for a Reconstruction that wrote no Recovered Solution", async () => {
    const page = render();
    await reconstruct("/fixtures/native/hello.exe");
    send(page.source(), "ended", {
      kind: "rejected",
      inputKind: "native-executable",
      explanation: '"hello.exe" is a Native Executable.',
    } satisfies ReconstructionEnd);

    expect(document.querySelector('section[aria-label="Report"]')).toBeNull();
    expect(
      document.querySelector('[data-outcome="rejected"]')?.textContent,
    ).toContain("Xray cannot reconstruct this file");
  });
});
