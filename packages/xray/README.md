# Xray

Xray turns compiled .NET applications back into **buildable, runnable C# solutions**.

Point it at a .NET `.exe` or `.dll` and Xray decompiles it, generates an SDK-style solution, and verifies it with `dotnet build`. Its web UI, on `127.0.0.1`, shows you the recovered code and lets you download it as a zip. Where a perfect result isn't possible, it tells you exactly what's missing.

Xray is intended for Assemblies you own or have the right to analyse.

## Install

You need Node.js 26 or later and a .NET SDK 8 or later.

```bash
pnpm add -g @adrianeyre/xray
xray doctor
```

`xray doctor` checks your Node.js, your .NET SDK, and that the engine bundled with Xray starts.

## Use

```bash
xray ui                                   # the web UI, on http://127.0.0.1:9729/
xray inspect MyApp.exe [--json]           # an Assembly's metadata summary
xray reconstruct MyApp.exe -o ./out       # --force, --no-build, --run, --no-siblings, --offline
xray --help                               # every command, option and exit code
```

Every Reconstruction writes `xray-report.json` beside the `.sln`, classing it as a Full Reconstruction, which builds, or a Partial one, saying why. Xray runs only on your machine: nothing you give it is uploaded anywhere, and the only network traffic is NuGet lookups and restores, which `--offline` turns off. Native Executables (C, C++ and the like) are detected and rejected, and obfuscated input is not deobfuscated.

## Documentation

- [Project site](https://xray.adrianeyre.co.uk/), [README](https://github.com/adrianeyre/xray#readme), [Glossary](https://github.com/adrianeyre/xray/blob/main/GLOSSARY.md) and [Changelog](https://github.com/adrianeyre/xray/blob/main/CHANGELOG.md)
- [`xray ui`](https://github.com/adrianeyre/xray/blob/main/docs/reference/xray-ui.md), [`xray reconstruct`](https://github.com/adrianeyre/xray/blob/main/docs/reference/xray-reconstruct.md), [`xray inspect --json`](https://github.com/adrianeyre/xray/blob/main/docs/reference/xray-inspect-json.md), [`xray-report.json`](https://github.com/adrianeyre/xray/blob/main/docs/reference/xray-report-json.md)

## Licence

MIT. Decompilation is powered by [ILSpy](https://github.com/icsharpcode/ILSpy)'s `ICSharpCode.Decompiler` (MIT); see `THIRD-PARTY-NOTICES.md`.
