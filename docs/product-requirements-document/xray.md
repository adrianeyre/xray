# Xray — Product Requirements Document

| | |
|---|---|
| **Product** | Xray |
| **Repository** | `adrianeyre/temp` (to be renamed on completion) |
| **Package** | `@adrianeyre/xray` |
| **Status** | Draft |
| **Date** | 2026-10-07 |
| **Glossary** | [`GLOSSARY.md`](../../GLOSSARY.md) |
| **Decisions** | [`docs/architectural-decision-record/`](../architectural-decision-record/) |

## 1. Summary

Xray is a local, web-based tool that takes a compiled .NET application (`.exe` / `.dll`) and performs a **Reconstruction**: it turns the **Managed Assembly** back into a **Recovered Solution** — a `.sln` with SDK-style C# projects, source, resources and dependencies — that builds with `dotnet build` and behaves like the original. Users point the browser UI at an assembly, watch the pipeline run, browse the recovered code, see what did and didn't resolve, and download the solution as a zip. A CLI exposes the same core for scripting and CI.

## 2. Problem

Existing .NET decompilers (ILSpy, dnSpyEx, dotPeek) are excellent at showing readable C# for individual types and members, but turning an assembly into a project that actually **builds and runs** is still largely manual: resolving NuGet packages, wiring multi-assembly apps together, recovering resources and XAML, choosing the right target framework, and iterating on build errors. Xray automates that last mile and is explicit about where it fell short.

## 3. Goals

1. Produce a **Full Reconstruction** — a Recovered Solution that builds and behaves like the original — for un-obfuscated Managed Assemblies whose dependencies are obtainable.
2. When that isn't possible, produce a **Partial Reconstruction** with a precise, actionable list of what failed (Unresolved Dependencies, build errors with file/line).
3. Provide a browser UI that makes the process visible: progress, recovered code, report.
4. Prove correctness continuously with **Round-trip** tests over a graded set of **Fixtures**.
5. Run on Windows, macOS and Linux.

## 4. Non-goals

- **Native Executables** (C/C++/Rust/Go etc.) — detected and rejected with an explanation. A native disassembly/pseudocode mode is a future phase, never "runnable source".
- **Deobfuscation**, licence-check removal, or bypassing any protection mechanism. Obfuscated input is detected and reported, not undone.
- A **hosted / public** web service. Xray runs locally only; GitHub Pages hosts the project site (landing page, docs, install instructions), not the app.
- Editing recovered code or rebuilding from inside the browser (v1).
- Persisting a history of past Reconstructions (v1).
- Writing our own IL→C# decompiler (see [ADR 0001](../architectural-decision-record/0001-typescript-cli-with-csharp-engine-sidecar.md)).

## 5. Intended use

Xray is intended for Assemblies the user owns or has the right to analyse — e.g. recovering lost source for their own software, studying how C# features compile, or maintaining legacy internal applications. The README and the UI state this.

## 6. Users and key scenarios

**Primary user:** a developer on Windows, macOS or Linux with Node and a .NET SDK installed.

1. **Recover my own app.** Drag a folder containing `MyApp.exe` and its DLLs into the UI → get a solution with one project per Sibling Assembly, NuGet packages restored, build succeeded → download zip.
2. **Explore an assembly.** Drop a single `.dll` → see the inspect summary and browse recovered C# without building.
3. **Understand why it didn't build.** A Partial Reconstruction shows two Unresolved Dependencies and four build errors, each linking to the offending line in the code viewer.
4. **Script it.** `xray reconstruct MyApp.exe -o ./out` in CI; parse `xray-report.json`.
5. **Native file.** Drop a C++ `.exe` → told clearly it's a Native Executable and why it can't be reconstructed.

## 7. Functional requirements

### 7.1 Input

- FR-1: Accept a single `.exe` / `.dll`, or a folder, via drag-and-drop, file picker, or a local path text box (path avoids uploading large apps).
- FR-2: Classify input as Managed Assembly, Native Executable, or not a PE file. Reject non-managed input with an explanatory message.
- FR-3: Detect likely obfuscation (mangled identifiers, known obfuscator attributes, encrypted string patterns); continue, but flag the result as obfuscated in the report.
- FR-4: If a matching `.pdb` sits beside the Assembly, use it automatically to recover local variable names and original source file layout.

### 7.2 Inspect

- FR-5: Produce a metadata summary: assembly name/version, target framework, architecture/bitness, entry point, output kind (console/WinForms/WPF/library), referenced assemblies, type/method/resource counts, presence of PDB, obfuscation indicators.
- FR-6: Available as `xray inspect <assembly>` and as a panel in the UI.

### 7.3 Reconstruction pipeline

Stages, each reporting progress: **analyse → decompile → resolve dependencies → generate solution → build**.

- FR-7 **Decompilation:** decompile every type to C# via the engine sidecar, one file per type, laid out by namespace (or by PDB source paths when available).
- FR-8 **Target framework:** preserve the original TFM. Fully supported: .NET Framework 4.0–4.8.1, .NET Core 3.1, .NET 5+. Best effort: .NET Framework 2.0/3.5, `netstandard`.
- FR-9 **Project format:** always emit SDK-style `.csproj`; .NET Framework targets use `Microsoft.NETFramework.ReferenceAssemblies` so they build on any OS. Recover assembly attributes, output type, `AllowUnsafeBlocks`, nullable context, etc.
- FR-10 **Dependency Resolution**, in order, per referenced assembly:
  1. Framework/BCL — covered by the TFM.
  2. NuGet — matched by name + version + public key token → `PackageReference`. Looked up in the local NuGet cache first, then nuget.org; `--offline` skips the network (such references fall through to steps 4–5).
  3. Sibling Assembly in the input folder → reconstructed as its own project, wired via `ProjectReference`.
  4. Other binary present in input → copied to `Dependencies/`, referenced via `HintPath`.
  5. Otherwise → **Unresolved Dependency**; Reconstruction becomes Partial.
- FR-11 **Multi-assembly:** Sibling Assembly reconstruction is on by default; can be disabled (`--no-siblings` / UI toggle).
- FR-12 **Resources:** recover embedded resources and `.resx`; WinForms designer code is emitted as C# `InitializeComponent`; WPF **BAML is decompiled to XAML** with correct build actions.
- FR-13 **Build verification:** run `dotnet build` on the Recovered Solution by default (`--no-build` to skip); parse diagnostics and map them to files/lines.
- FR-14 **Run (opt-in):** `--run` launches the rebuilt program where its target framework can run (WinForms/WPF only on Windows).
- FR-15 **Outcome:** classify as Full Reconstruction (built; and ran, if requested) or Partial Reconstruction (with reasons).

### 7.4 Report

- FR-16: Every Reconstruction writes `xray-report.json` into the Recovered Solution: inputs, inspect summary, per-dependency resolution outcome, Unresolved Dependencies, obfuscation flag, build result and diagnostics, timings, outcome.
- FR-17: The CLI prints a human-readable summary; the UI renders the same data.

### 7.5 Web UI (primary interface)

- FR-18: `xray ui` starts a local server on `127.0.0.1` and opens the browser.
- FR-19: Live pipeline progress (streamed; updates at least once per second).
- FR-20: Inspect summary panel.
- FR-21: File-tree explorer of the Recovered Solution with a read-only code viewer (C# and XAML highlighting).
- FR-22: Report panel: Dependency Resolution table, Unresolved Dependencies, build diagnostics that link to file/line in the viewer.
- FR-23: Download the Recovered Solution as a `.zip`.

### 7.6 CLI

- FR-24: `xray inspect <assembly> [--json]`
- FR-25: `xray reconstruct <assembly|folder> -o <dir> [--no-build] [--run] [--no-siblings] [--offline]`
- FR-26: `xray ui [--port <n>]`
- FR-27: `xray doctor` — verifies Node version, .NET SDK presence/version (8+), engine health; explains how to fix anything missing.
- FR-28: Non-zero exit code on rejection or Partial Reconstruction (distinct codes).

## 8. Non-functional requirements

- **Platforms:** Windows, macOS, Linux; all three in CI.
- **Runtime:** Node 26+, pnpm 12+ (required via `engines`; `packageManager` pins the version development and CI use, pnpm 12.10.0); .NET SDK 8+ required at runtime.
- **Performance (soft target):** ~5 MB / ~2,000-type assembly reconstructs in < 60 s excluding `dotnet build` on a typical developer laptop.
- **Security:** server binds to `127.0.0.1` only; uploads and outputs live in a temporary workspace deleted when the server stops. The user's Assemblies and Recovered Solutions never leave the machine; the only network traffic is NuGet package metadata lookups and restores, disabled by `--offline`. `--run` executes recovered code and is opt-in and clearly labelled.
- **Licensing:** Xray is MIT; ship ILSpy / `ICSharpCode.Decompiler` (MIT) notices.

## 9. Architecture

See [ADR 0001](../architectural-decision-record/0001-typescript-cli-with-csharp-engine-sidecar.md).

```text
 Browser (React + Monaco)        Terminal
          │  HTTP + SSE              │
          ▼                          ▼
   packages/server (Fastify)   packages/cli
          └──────────┬───────────────┘
                     ▼
              packages/core  ── Reconstruction pipeline, Dependency
                     │          Resolution, solution generation,
                     │          build verification, report
                     │  JSON over stdio
                     ▼
              engine/ (C# sidecar)
              ICSharpCode.Decompiler + BAML decompiler
              "Assembly in → metadata / C# / XAML out"
```

- **core** owns all behaviour; **cli** and **server** are thin adapters over it.
- **engine** is a framework-dependent .NET DLL bundled inside the npm package (one artefact for all OSes).
- **web** is a static React + Vite build served by **server**.

### Repository layout

```text
packages/
  core/      TypeScript — pipeline, resolution, generation, report
  cli/       TypeScript — `xray` binary
  server/    TypeScript — Fastify, SSE progress, local workspace
  web/       TypeScript — React + Vite + Monaco
engine/      C# sidecar + its tests
fixtures/    C# Fixture projects for Round-trip tests
docs/        PRD, ADRs
```

### Tooling

pnpm workspace · ESM · strict TypeScript · Vitest · ESLint + Prettier · GitHub Actions (Windows/macOS/Linux matrix) · semantic-release for versioning and npm publishing of `@adrianeyre/xray`.

## 10. Verification strategy

- **Round-trip tests:** each Fixture is compiled in CI, reconstructed by Xray, rebuilt, and compared.
  - Console Fixtures: identical stdout, stderr and exit code across a set of inputs.
  - GUI Fixtures (WinForms/WPF): must build; optional Windows-only "launches without crashing" smoke test.
- **Fixture ladder:** arithmetic → control flow → classes/structs → generics → closures/LINQ → async/await → records/pattern matching → resources → multi-assembly → NuGet dependencies → WinForms → WPF. Plus negative Fixtures: a native C/C++ executable, an obfuscated assembly.
- **Unit tests:** core (Vitest) and engine (.NET test project).

## 11. Roadmap

Each phase is complete when its Fixtures pass the Round-trip on all three OSes.

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Inspect** | Repo/tooling scaffold, engine sidecar, `xray inspect`, `xray doctor`, Native Executable rejection | Inspect output correct for all Fixtures; native Fixture rejected |
| **2. Console apps + Web UI** | Single-assembly, framework-only Reconstruction; build verification; report; `xray ui` with progress, explorer, viewer, report, zip | Console Fixtures (arithmetic → records/pattern matching) Full Reconstruction |
| **3. Dependencies** | NuGet resolution, Sibling Assemblies → multi-project solutions, copied binaries, Unresolved Dependency reporting, PDB use, obfuscation detection | Multi-assembly and NuGet Fixtures Full; obfuscated Fixture flagged |
| **4. Resources + WinForms** | Embedded resources, `.resx`, WinForms | Resources and WinForms Fixtures build |
| **5. WPF + v1.0** | BAML → XAML; performance benchmark; real-app smoke test; GitHub Pages project site; v1.0 release | WPF Fixture builds; benchmark within target; v1.0 published |
| **6. Future** | Native disassembly/pseudocode mode (x86/x64 → IR → CFG → pseudocode); history; in-browser editing; **browser edition** (engine compiled to WebAssembly, runs entirely in the page — e.g. on GitHub Pages — without build verification) | — |

## 12. Risks

| Risk | Mitigation |
|---|---|
| Decompiled C# doesn't recompile (compiler-generated constructs, async state machines, unsafe code, newer language features) | Rely on the mature ILSpy engine; Fixture ladder targets each construct; surface build diagnostics precisely |
| NuGet identification ambiguity (same assembly in many packages/versions) | Match on name + version + public key token; fall back to copied binary rather than guessing wrongly; report the choice |
| Node ↔ .NET sidecar adds operational complexity | Single framework-dependent DLL; `xray doctor`; version handshake on start |
| WinForms/WPF can't run off Windows | Build-only verification elsewhere; run smoke test on Windows CI only |
| Misuse against software the user doesn't have rights to | Stated intended use; no deobfuscation or protection bypass; local-only |

## 13. Decisions log

Settled during design review (2026-10-07):

- Working tool over hand-built internals; reuse `ICSharpCode.Decompiler`.
- Managed .NET only in v1; native rejected; obfuscation detected, not undone. ([ADR 0002](../architectural-decision-record/0002-managed-dotnet-only.md))
- "Fully working" = builds and behaves the same, proven by Round-trip; otherwise Partial with reasons.
- Local web UI is the primary interface; CLI alongside; no hosted service. ([ADR 0003](../architectural-decision-record/0003-local-only-web-ui.md))
- TypeScript (Node 26+ / pnpm 12+) + C# sidecar over JSON stdio (ADR 0001).
- SDK-style projects always; original TFM preserved. ([ADR 0004](../architectural-decision-record/0004-sdk-style-projects-for-all-frameworks.md))
- Dependency Resolution order: framework → NuGet → Sibling Assembly → copied binary → unresolved.
- Sibling Assemblies reconstructed by default; BAML→XAML in v1; PDBs used when present.
- React + Vite + Monaco, Fastify + SSE; ESLint + Prettier, Vitest, semantic-release, GitHub Actions on three OSes.
- Server bound to `127.0.0.1`, temporary workspace, no history; MIT licence.

Settled during issue planning (2026-10-07):

- Files never leave the machine; NuGet lookups/restores are the only network traffic; `--offline` disables them.
- `xray inspect --json` for scripting.
- GitHub Pages hosts the project site only; a WebAssembly browser edition is a Phase 6 item. A static UI on Pages talking to a local backend was rejected (no install saved; browser private-network restrictions; any site could drive the local server).
