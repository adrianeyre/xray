import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IntendedUse } from "./App.js";
import { buildFileTree } from "./file-tree.js";
import { inspectFacts } from "./inspect-summary.js";
import { SolutionExplorer } from "./SolutionExplorer.js";
import { buildResult, OUTCOMES, reportTimings, RESOLUTIONS } from "./report.js";
import { ARITHMETIC } from "./test-inspection.js";
import { isBinary, languageOf } from "./viewer-files.js";

// Holds the `xray ui` reference's account of what the page shows to the web
// app, so it cannot drift from it.

const REFERENCE = fileURLToPath(
  new URL("../../../docs/reference/xray-ui.md", import.meta.url),
);

async function section(heading: string): Promise<string> {
  const reference = await readFile(REFERENCE, "utf8");
  const start = reference.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = reference.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Markdown's `**bold**` and `` `code` ``, as plain text. */
function plain(markdown: string): string {
  return markdown.replaceAll("**", "").replaceAll("`", "");
}

describe("the xray ui reference", () => {
  it("quotes the intended-use notice as the page states it", async () => {
    const intendedUse = await section("## Intended use");
    const quoted = /^> (.*)$/m.exec(intendedUse)?.[1] ?? "";
    // Its text, without its markup; it has no entity to decode.
    const notice = renderToStaticMarkup(<IntendedUse />).replaceAll(
      /<[^>]+>/g,
      "",
    );

    expect(notice).not.toContain("&");
    expect(plain(quoted)).toBe(notice);
  });

  it("names every field of the inspect summary, in the order the page shows them", async () => {
    const summary = await section("## The inspect summary");
    const named = [...summary.matchAll(/\*\*([^*]+)\*\*/g)]
      .map((match) => match[1] as string)
      .filter((name) => !/^(references|As )/.test(name));

    expect(named).toEqual(inspectFacts(ARITHMETIC).map(([label]) => label));
    expect(summary).toContain("**As `xray inspect --json` prints it**");
  });

  it("says which files the viewer highlights as C#, as XML and as solutions, which it does not read, and how the tree sorts names, as the page does", async () => {
    const browsing = await section("## Browsing the Recovered Solution");

    expect(browsing).toContain(
      "C# files (`.cs`) are highlighted as C#; XAML files (`.xaml`), projects (`.csproj`) and `.resx` files as XML; and solutions (`.sln`) as solutions, their header, comments, keywords, quoted names and paths, GUIDs and version numbers each highlighted; every other file is shown as plain text, but for a binary (`.dll` or `.exe`, as copied into `Dependencies/`; or a resource embedded as it is, an image such as `.png`, a `.resources` file, or the bytes a `.resx` refers to, `.bin`), which is not read",
    );
    expect(isBinary("Phrasebook/Assets.flag.png")).toBe(true);
    expect(isBinary("Phrasebook/Limits.resources")).toBe(true);
    expect(isBinary("Phrasebook/Images/Data.bin")).toBe(true);
    expect(isBinary("Phrasebook/Strings.resx")).toBe(false);
    expect(languageOf("Arithmetic/Program.cs")).toBe("csharp");
    expect(languageOf("Tally/MainWindow.xaml")).toBe("xml");
    expect(languageOf("Arithmetic/Arithmetic.csproj")).toBe("xml");
    expect(languageOf("Phrasebook/Strings.resx")).toBe("xml");
    expect(languageOf("Arithmetic.sln")).toBe("sln");
    expect(languageOf("xray-report.json")).toBe("plaintext");
    expect(isBinary("Dependencies/Kestrelwood.Checksums.dll")).toBe(true);
    expect(isBinary("Dependencies/Tool.EXE")).toBe(true);
    expect(isBinary("Arithmetic/Arithmetic.csproj")).toBe(false);
    expect(browsing).toContain("(`Type2.cs` before `Type10.cs`)");
    expect(
      buildFileTree([
        { path: "Type10.cs", size: 0 },
        { path: "Type2.cs", size: 0 },
      ]).children.map((child) => child.name),
    ).toEqual(["Type2.cs", "Type10.cs"]);
    expect(browsing).toContain("Each folder lists its folders, then its files");
  });

  it("names the report's outcomes, its timings, and how it says a build went, as the page shows them", async () => {
    const report = await section("## The report");

    for (const { title } of Object.values(OUTCOMES)) {
      expect(report).toContain(`**${title}**`);
    }
    const timings = reportTimings({
      analyse: 1,
      decompile: 1,
      resolveDependencies: null,
      generate: 1,
      build: null,
      run: null,
      total: 1,
    });
    const notRun = timings
      .filter(([, time]) => !/\d/.test(time))
      .map(([, time]) => `\`${time}\``);
    expect(notRun).toHaveLength(3);
    expect(report).toContain(
      `how long each stage took (${timings
        .slice(0, -1)
        .map(([stage]) => stage)
        .join(
          ", ",
        )}), ${notRun.slice(0, -1).join(", ")} or ${notRun.at(-1)} for one that did not run, and the ${timings.at(-1)?.[0]}`,
    );
    const error = { severity: "error", code: "CS0246", message: "" } as const;
    const warning = { ...error, severity: "warning" } as const;
    expect(buildResult({ succeeded: true, diagnostics: [] })).toBe("succeeded");
    expect(
      buildResult({
        succeeded: false,
        diagnostics: [error, error, error, error, warning],
      }),
    ).toBe("failed with 4 errors and 1 warning");
    expect(report).toContain(
      "(`succeeded`, or `failed with 4 errors and 1 warning`, as `xray reconstruct` says it)",
    );
    expect(report).toContain("the errors first, then the warnings");
  });

  it("names every way the Dependency Resolution table says a reference was resolved, as the page shows them", async () => {
    const report = await section("## The report");

    const labels = Object.values(RESOLUTIONS).map((label) => `**${label}**`);
    expect(labels).toHaveLength(5);
    expect(report).toContain(
      `how it was resolved, ${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}, the last marked in red`,
    );
  });

  it("names the button that downloads the Recovered Solution, and where it is, as the page shows it", async () => {
    const downloading = await section("## Downloading the Recovered Solution");
    const page = renderToStaticMarkup(
      <SolutionExplorer
        reconstruction="0f8fad5b-d9cb-469f-a165-70867728950e"
        solutionPath="Arithmetic.sln"
        transport={{
          fetch: () => Promise.reject(new Error("Not in this test.")),
          openEventSource: () => {
            throw new Error("Not in this test.");
          },
          put: () => Promise.reject(new Error("Not in this test.")),
        }}
        createViewer={() => Promise.reject(new Error("Not in this test."))}
      />,
    );
    const heading = /<h2>(.*?)<\/h2>/
      .exec(page)?.[1]
      ?.replaceAll(/<[^>]+>/g, "");

    expect(downloading).toContain(
      "Under **Recovered Solution**, **Download .zip**",
    );
    expect(heading).toBe("Recovered Solution Arithmetic.sln");
    expect(page).toMatch(
      /<a [^>]*class="download-button"[^>]*>Download \.zip<\/a>/,
    );
  });
});
