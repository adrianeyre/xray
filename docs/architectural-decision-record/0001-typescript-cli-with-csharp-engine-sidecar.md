# TypeScript CLI with a C# decompilation engine sidecar

Xray is written in TypeScript on Node, but no credible IL→C# decompiler exists outside .NET, so Decompilation is delegated to a small C# sidecar that wraps `ICSharpCode.Decompiler` (ILSpy's engine, MIT) and speaks JSON over stdio. The sidecar does only "Assembly in → metadata / C# / XAML out"; everything else (pipeline, Dependency Resolution, solution layout, build verification, reporting) lives in TypeScript.

## Considered Options

- **Shell out to `ilspycmd`**: rejected; its whole-project output gives too little control over project generation, which is where "buildable" is won or lost.
- **Write an IL decompiler in TypeScript**: rejected; years of work duplicating a mature open-source engine.

## Consequences

Users need a .NET SDK installed — acceptable because `dotnet build` verification needs it anyway.
