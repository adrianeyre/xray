import { describe, expect, it } from "vitest";

import { isBinary, languageOf } from "./viewer-files.js";

describe("languageOf", () => {
  it("highlights C# files as C#", () => {
    expect(languageOf("App/Program.cs")).toBe("csharp");
    expect(languageOf("App/Properties/AssemblyInfo.CS")).toBe("csharp");
    expect(languageOf("App/MainWindow.xaml.cs")).toBe("csharp");
  });

  it("highlights XAML files, projects and .resx files as XML", () => {
    expect(languageOf("App/MainWindow.xaml")).toBe("xml");
    expect(languageOf("App/Themes/Palette.XAML")).toBe("xml");
    expect(languageOf("App/App.csproj")).toBe("xml");
    expect(languageOf("App/APP.CSPROJ")).toBe("xml");
    expect(languageOf("App/Strings.resx")).toBe("xml");
    expect(languageOf("App/Strings.fr.resx")).toBe("xml");
    expect(languageOf("App/Form1.RESX")).toBe("xml");
  });

  it("highlights solution files as solutions", () => {
    expect(languageOf("App.sln")).toBe("sln");
    expect(languageOf("APP.SLN")).toBe("sln");
  });

  it("shows a file of any other type as plain text", () => {
    expect(
      [
        "xray-report.json",
        "App/App.config",
        "App/Assets/notes.txt",
        "README",
        "App/Program.cs.bak",
        "App/App.csproj.user",
        "App.sln.DotSettings",
        "App/xaml",
      ].map(languageOf),
    ).toEqual(Array(8).fill("plaintext"));
  });
});

describe("isBinary", () => {
  it("does not read an Assembly, or a resource embedded as it is, as text", () => {
    expect(isBinary("Dependencies/Kestrelwood.Checksums.dll")).toBe(true);
    expect(isBinary("Tally/Assets/tally.png")).toBe(true);
    expect(isBinary("Phrasebook/Limits.resources")).toBe(true);
    expect(isBinary("Phrasebook/Strings.resx")).toBe(false);
    expect(isBinary("Tally/MainWindow.xaml")).toBe(false);
  });
});
