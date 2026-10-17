import { ExitCode } from "@xray/cli";

import type { IconName } from "./icons.js";

// What the site's page says about Xray, section by section, as data, so its
// layout (site.ts) and its structured data for search engines read the same
// words. A `code` span is written in Markdown's backticks.

export interface Card {
  readonly icon: IconName;
  readonly title: string;
  readonly text: string;
}

/** At a glance, just below the hero. */
export const FACTS: readonly Card[] = [
  {
    icon: "hammer",
    title: "Buildable",
    text: "SDK-style solutions, verified with `dotnet build`",
  },
  {
    icon: "report",
    title: "Honest",
    text: "Full or Partial, and exactly why",
  },
  {
    icon: "lock",
    title: "Local only",
    text: "Nothing you give it leaves your machine",
  },
  {
    icon: "scale",
    title: "Open source",
    text: "MIT, on ILSpy's decompiler",
  },
];

/** What Xray reconstructs, as the hero lists it. */
export const FRAMEWORKS: readonly string[] = [
  ".NET Framework 4.0–4.8.1",
  ".NET Core 3.1",
  ".NET 5 and later",
  "Windows Forms",
  "WPF",
  ".NET Framework 2.0/3.5 (best effort)",
  "netstandard (best effort)",
];

/** What sets Xray apart from a decompiler, in four words. */
export const PRINCIPLES: readonly Card[] = [
  {
    icon: "hammer",
    title: "A solution, not a listing",
    text: "A decompiler shows you code. Xray writes a Visual Studio solution you can open, build and run, with its projects, references, resources and packages in place.",
  },
  {
    icon: "report",
    title: "Honest about the result",
    text: "Every Reconstruction is proved by building it, and reported as a Full Reconstruction or a Partial one, with each Unresolved Dependency and build error at its file and line.",
  },
  {
    icon: "lock",
    title: "Yours, on your machine",
    text: "Xray runs only on your computer. Its web UI listens on `127.0.0.1`, and its only network traffic is NuGet package lookups, which `--offline` turns off.",
  },
  {
    icon: "shield-check",
    title: "Responsible by design",
    text: "Built for software you own or have the right to analyse. It flags obfuscation rather than undoing it, and never runs recovered code unless you ask.",
  },
];

export interface Stage {
  readonly icon: IconName;
  readonly name: string;
  readonly text: string;
}

/** The pipeline, stage by stage, as the UI shows it running. */
export const STAGES: readonly Stage[] = [
  {
    icon: "search",
    name: "Analyse",
    text: "Reads the Assembly's metadata: its target framework, references, resources, PDB and any sign of obfuscation. A Native Executable is rejected here, saying what it is.",
  },
  {
    icon: "code",
    name: "Decompile",
    text: "ILSpy's decompiler writes each type to a file of its own, WPF's BAML back to XAML, and each resource and `.resx` beside its code.",
  },
  {
    icon: "network",
    name: "Resolve dependencies",
    text: "Each reference is satisfied by the framework, a NuGet `PackageReference`, a Sibling Assembly as a project of its own, or a copied binary. Anything else is reported.",
  },
  {
    icon: "folder",
    name: "Generate solution",
    text: "Writes an SDK-style `.sln` and `.csproj` for every project, keeping the original target framework, output type and platform.",
  },
  {
    icon: "hammer",
    name: "Build",
    text: "Runs `dotnet build` to prove the Recovered Solution compiles, and points each error at its file and line.",
  },
  {
    icon: "play",
    name: "Run, if you ask",
    text: "With `--run`, runs the rebuilt program to check it behaves. It executes recovered code, so the web UI never does.",
  },
];

/** Everything Xray does, as cards. */
export const FEATURES: readonly Card[] = [
  {
    icon: "monitor",
    title: "A local web UI",
    text: "`xray ui` opens a browser app on `127.0.0.1`. Drop in an Assembly or a folder, or give its path, and follow each stage live.",
  },
  {
    icon: "terminal",
    title: "A CLI for scripts and CI",
    text: "`xray inspect`, `xray reconstruct` and `xray doctor`, with JSON output, a report file and exit codes a pipeline can act on.",
  },
  {
    icon: "code",
    title: "Browse the recovered code",
    text: "Read every file of the Recovered Solution in the editor of Visual Studio Code, with each build error opening at its line, then download it as a zip.",
  },
  {
    icon: "network",
    title: "Dependency Resolution",
    text: "Framework, NuGet package, Sibling Assembly or copied binary: every reference is resolved and listed with why, or reported as an Unresolved Dependency.",
  },
  {
    icon: "layers",
    title: "Sibling Assemblies",
    text: "An application's own DLLs beside it become projects of their own in the same solution, wired together with `ProjectReference`.",
  },
  {
    icon: "package",
    title: "NuGet packages",
    text: "A reference a package holds becomes a `PackageReference`, found in your global-packages cache or on nuget.org, or only offline with `--offline`.",
  },
  {
    icon: "layout",
    title: "Windows Forms and WPF",
    text: "The designer's `InitializeComponent` for Windows Forms, and WPF's BAML decompiled back to XAML, with its code-behind.",
  },
  {
    icon: "image",
    title: "Resources",
    text: "Embedded resources and `.resx` files, satellite cultures included, recovered under their own names.",
  },
  {
    icon: "key",
    title: "PDBs",
    text: "An Assembly's own PDB, beside it, gives back its locals' names and its source files' layout.",
  },
  {
    icon: "target",
    title: "The original target framework",
    text: "From .NET Framework 4.0 to .NET 5 and later, kept as it was, in SDK-style projects that build on Windows, macOS and Linux.",
  },
  {
    icon: "report",
    title: "xray-report.json",
    text: "Every Reconstruction writes a report beside its `.sln`: its outcome, timings, dependencies, diagnostics and anything it could not do.",
  },
  {
    icon: "shield",
    title: "Obfuscation flagged",
    text: "Signs of an obfuscator are detected and reported, and the Assembly reconstructed as it is: never deobfuscated.",
  },
];

export interface Outcome {
  readonly icon: IconName;
  readonly tone: "success" | "warning" | "info" | "danger";
  readonly name: string;
  /** The exit code `xray reconstruct` ends with. */
  readonly code: number;
  readonly text: string;
}

/** How a Reconstruction can end, and the exit code it ends with. */
export const OUTCOMES: readonly Outcome[] = [
  {
    icon: "check",
    tone: "success",
    name: "Full Reconstruction",
    code: ExitCode.ok,
    text: "The Recovered Solution builds, and with `--run` its program runs.",
  },
  {
    icon: "alert",
    tone: "warning",
    name: "Partial Reconstruction",
    code: ExitCode.partial,
    text: "A Recovered Solution is written, and `xray-report.json` lists each Unresolved Dependency and build error that stopped it building.",
  },
  {
    icon: "help",
    tone: "info",
    name: "Unverified",
    code: ExitCode.ok,
    text: "With `--no-build`, the Recovered Solution is written but not built, so Xray does not claim it builds.",
  },
  {
    icon: "ban",
    tone: "danger",
    name: "Rejected",
    code: ExitCode.rejected,
    text: "Not a Managed Assembly: a Native Executable or not a PE file at all, said plainly, with nothing written.",
  },
];

export interface Question {
  readonly question: string;
  readonly answer: string;
}

/** What people ask before they try Xray. Also given to search engines, as a FAQPage. */
export const FAQ: readonly Question[] = [
  {
    question: "What does Xray do?",
    answer:
      "Xray turns a compiled .NET application, an `.exe` or `.dll`, or a folder holding one, back into a C# solution you can open in Visual Studio, build with `dotnet build` and run. It decompiles the Assembly, resolves every dependency, writes SDK-style projects, and proves the result by building it.",
  },
  {
    question: "Is it legal to decompile an application?",
    answer:
      "Xray is for Assemblies you own or have the right to analyse: recovering lost source for your own software, studying how C# features compile, or maintaining legacy internal applications. Whether you may decompile someone else's software depends on its licence and the law where you are, so check both first.",
  },
  {
    question: "Does Xray upload my code anywhere?",
    answer:
      "No. Xray runs entirely on your machine; its web UI listens only on `127.0.0.1`, and what you give it is kept in a temporary Workspace deleted when it stops. Its only network traffic is NuGet package lookups and restores, which `xray reconstruct --offline` turns off.",
  },
  {
    question: "Will the Recovered Solution match the original source?",
    answer:
      "It behaves the same, but it is not the same text: comments, formatting and, without the Assembly's own PDB, local variable names are not in a compiled Assembly, so they cannot be recovered. Review a Recovered Solution before you rely on it.",
  },
  {
    question: "Can it reconstruct obfuscated or native applications?",
    answer:
      "Native Executables, compiled from C, C++, Rust, Go and the like, are detected and rejected: machine code cannot be turned back into runnable source. Obfuscated Assemblies are flagged, and reconstructed as they are; Xray never undoes obfuscation or bypasses licence checks.",
  },
  {
    question: "Which versions of .NET does it support?",
    answer:
      ".NET Framework 4.0 to 4.8.1, .NET Core 3.1, and .NET 5 and later, fully; .NET Framework 2.0 and 3.5, and netstandard, on a best-effort basis. The original target framework is kept, and every project is SDK-style, so it builds on Windows, macOS and Linux.",
  },
  {
    question: "Does Xray run the code it recovers?",
    answer:
      "Only if you ask, from the command line, with `xray reconstruct --run`, and only once the Recovered Solution builds. The web UI never runs recovered code.",
  },
  {
    question: "Do I need Node.js to run it?",
    answer:
      "Not if you download it: each release has a download for Windows, macOS and Linux, on x64 and Arm, that holds the Node.js it runs on. Installing it from npm, with `pnpm add -g @adrianeyre/xray`, needs Node.js 26 or later. Either way, you need the .NET SDK 8 or later, which builds what Xray recovers.",
  },
  {
    question: "What does it cost?",
    answer:
      "Nothing. Xray is free, open-source software under the MIT licence, and its decompilation is powered by ILSpy's `ICSharpCode.Decompiler`, also MIT.",
  },
];
