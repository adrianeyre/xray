// @vitest-environment happy-dom

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  highlight,
  highlightedXamlParts,
  ofType,
  xamlParts,
} from "./test-highlight.js";
import { languageOf } from "./viewer-files.js";

// Holds what each part of a file the code viewer shows is highlighted as.

// A path, not a URL: happy-dom's URL is not Node.js's.
const FIXTURES = join(import.meta.dirname, "..", "..", "..", "fixtures");

/** A Fixture's file, as its source holds it. */
function fixtureFile(path: string): Promise<string> {
  return readFile(join(FIXTURES, ...path.split("/")), "utf8");
}

describe("the code viewer's languages", () => {
  it("highlights the WPF Fixture's XAML as XML: each element's name, each attribute's name and each attribute's value", async () => {
    const xaml = (await readdir(join(FIXTURES, "wpf"), { recursive: true }))
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => path.endsWith(".xaml"))
      .sort();
    expect(xaml).toEqual([
      "App.xaml",
      "Controls/CountBadge.xaml",
      "MainWindow.xaml",
      "Themes/Palette.xaml",
    ]);

    for (const path of xaml) {
      const text = await fixtureFile(`wpf/${path}`);

      expect(languageOf(path), path).toBe("xml");
      expect(await highlightedXamlParts(path, text), path).toEqual(
        xamlParts(text),
      );
    }
    // The markup extensions, too, as values.
    const window = await highlight(
      "MainWindow.xaml",
      await fixtureFile("wpf/MainWindow.xaml"),
    );
    expect(ofType(window, "attribute.value.xml")).toContain(
      '"{StaticResource {x:Type Button}}"',
    );
  });

  it("highlights a project, and a .resx, as XML, comments and all", async () => {
    const project = await highlight(
      "Wpf.csproj",
      await fixtureFile("wpf/Wpf.csproj"),
    );
    expect(ofType(project, "tag.xml")).toEqual(
      expect.arrayContaining([
        "Project",
        "PropertyGroup",
        "UseWPF",
        "Resource",
      ]),
    );
    expect(ofType(project, "attribute.name.xml")).toEqual(["Sdk", "Include"]);
    expect(ofType(project, /^comment\./).join(" ")).toContain(
      "A .NET 8 WPF app",
    );

    const resx = await highlight(
      "Strings.resx",
      await fixtureFile("resources/Strings.resx"),
    );
    expect(ofType(resx, "tag.xml")).toEqual(
      expect.arrayContaining(["root", "data", "value"]),
    );
    expect(ofType(resx, "attribute.name.xml")).toContain("name");
  });

  it("highlights a solution's header, comment, keywords, names, paths and GUIDs", async () => {
    // As a Reconstruction writes one.
    const solution = [
      "Microsoft Visual Studio Solution File, Format Version 12.00",
      "# Visual Studio Version 17",
      "VisualStudioVersion = 17.0.31903.59",
      "MinimumVisualStudioVersion = 10.0.40219.1",
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Tally", "Tally\\Tally.csproj", "{2F1D9C3A-6B0E-4C55-9A3E-0D7B5E8F1A24}"',
      "EndProject",
      "Global",
      "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution",
      "\t\tDebug|Any CPU = Debug|Any CPU",
      "\tEndGlobalSection",
      "\tGlobalSection(ProjectConfigurationPlatforms) = postSolution",
      "\t\t{2F1D9C3A-6B0E-4C55-9A3E-0D7B5E8F1A24}.Debug|Any CPU.ActiveCfg = Debug|Any CPU",
      "\tEndGlobalSection",
      "EndGlobal",
      "",
    ].join("\n");

    const lines = await highlight("Tally.sln", solution);

    expect(ofType(lines, "metatag.sln")).toEqual([
      "Microsoft Visual Studio Solution File, Format Version 12.00",
    ]);
    expect(ofType(lines, "comment.sln")).toEqual([
      "# Visual Studio Version 17",
    ]);
    expect(ofType(lines, "keyword.sln")).toEqual([
      "Project",
      "EndProject",
      "Global",
      "GlobalSection",
      "preSolution",
      "EndGlobalSection",
      "GlobalSection",
      "postSolution",
      "EndGlobalSection",
      "EndGlobal",
    ]);
    expect(ofType(lines, "string.sln")).toEqual([
      '"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}"',
      '"Tally"',
      '"Tally\\Tally.csproj"',
      '"{2F1D9C3A-6B0E-4C55-9A3E-0D7B5E8F1A24}"',
    ]);
    expect(ofType(lines, "type.sln")).toEqual([
      "{2F1D9C3A-6B0E-4C55-9A3E-0D7B5E8F1A24}",
    ]);
    expect(ofType(lines, "number.sln")).toEqual([
      "17.0.31903.59",
      "10.0.40219.1",
    ]);
  });

  it("highlights C# as C#", async () => {
    const lines = await highlight(
      "MainWindow.xaml.cs",
      await fixtureFile("wpf/MainWindow.xaml.cs"),
    );

    expect(ofType(lines, /^keyword\.\w+\.cs$/)).toEqual(
      expect.arrayContaining(["namespace", "public", "partial", "class"]),
    );
  });

  it("shows a file of any other type as plain text, nothing in it highlighted", async () => {
    for (const path of [
      "xray-report.json",
      "Tally/App.config",
      "Tally/Assets/notes.txt",
      "README",
    ]) {
      const lines = await highlight(
        path,
        '<root a="b">{ "class": 1 } // not code</root>',
      );

      expect(languageOf(path), path).toBe("plaintext");
      expect(
        lines.flat().filter(({ type }) => type !== ""),
        path,
      ).toEqual([]);
    }
  });
});
