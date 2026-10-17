# Smoke test against a real application

Xray's first goal is a Full Reconstruction of an un-obfuscated Managed Assembly whose dependencies can be obtained (PRD §3), and its first scenario is a developer recovering their own app: an Assembly with its Sibling Assemblies and NuGet packages beside it (PRD §6). Fixtures prove each construct on its own; `pnpm real-app` proves the whole on an application nobody wrote for Xray. It reconstructs a real, permissively licensed .NET app, as it was released, and checks the outcome against what is expected of it, then runs the original and the rebuilt app side by side.

## The application

[**AwsWatchman**](https://github.com/justeattakeaway/AwsWatchman), by Just Eat Takeaway.com, creates and maintains AWS CloudWatch alarms from configuration files. Version 2.0.0 was released on 2023-11-16 as the .NET tool [`JustEatTakeaway.Watchman` 2.0.0](https://www.nuget.org/packages/JustEatTakeaway.Watchman/2.0.0) on nuget.org, built from commit [`6360ec8`](https://github.com/justeattakeaway/AwsWatchman/tree/6360ec8eefaca763ae9c30fbdea256263ad5162a). Its `tools/net8.0/any/` folder holds the app as `dotnet tool install` installs it:

- `Watchman.dll`, a .NET 8 console program, with its PDB;
- three Sibling Assemblies of its own, with their PDBs: `Watchman.Engine`, `Watchman.Configuration` and `Watchman.AwsResources`, none strong-named and none on nuget.org;
- the NuGet packages it uses: `Newtonsoft.Json` 13.0.3, `StructureMap` 4.7.1, `CommandLineParser` 2.9.1 (`CommandLine.dll`) and 15 of the AWS SDK for .NET's (`AWSSDK.Core`, `AWSSDK.S3`, `AWSSDK.CloudWatch`…, 3.7.x);
- `Watchman.deps.json` and `Watchman.runtimeconfig.json`.

It was chosen from about 150 of the most downloaded .NET tools on nuget.org with a `net8.0` build, as the one that best fits the scenario: an app of its own and Sibling Assemblies of its own, rather than a thin program over libraries published as packages, with third parties' NuGet packages, none of them signed by Microsoft (see [#48](https://github.com/adrianeyre/xray/issues/48)). Its package is immutable on nuget.org, and its SHA-512 is pinned, so the smoke test always reconstructs the very Assemblies released.

### Its licence

AwsWatchman is licensed under the [Apache License 2.0](https://github.com/justeattakeaway/AwsWatchman/blob/6360ec8eefaca763ae9c30fbdea256263ad5162a/LICENSE), as its package's `license` expression says too. Section 2 grants a perpetual, worldwide, no-charge licence to reproduce the Work and to prepare Derivative Works of it, with no condition on doing so; its conditions (section 4) apply only to redistributing it. The smoke test downloads the package, reconstructs it into a Recovered Solution, builds and runs it, in a temporary folder deleted afterwards. It never commits, publishes or redistributes the app, its Recovered Solution or anything built from it: CI keeps only the results, as JSON.

The packages it ships are as permissive: the AWS SDK for .NET and StructureMap are Apache-2.0, and Newtonsoft.Json and CommandLineParser are MIT. Xray only references them in the Recovered Solution, or copies them into its `Dependencies/` folder, which is deleted with it.

## What is checked

1. **The package.** It is downloaded from nuget.org and its SHA-512 checked against the one nuget.org's catalog records for it (`JcBoCsf…ZCFg==`). The files in `tools/net8.0/any/` are written to a folder, as `dotnet tool install` would, refusing any path that would leave it.
2. **The Reconstruction.** `Watchman.dll` is reconstructed by core's `reconstruct`, as `xray reconstruct` runs it by default: Sibling Assemblies on, NuGet lookups on (in the global-packages cache, then on nuget.org), and the Recovered Solution built with `dotnet build`. It must be a **Full Reconstruction** targeting `net8.0`, and every reference must be resolved as expected:

   | References | Expected resolution |
   | --- | --- |
   | `Watchman.Engine`, `Watchman.Configuration`, `Watchman.AwsResources` | `sibling-assembly`: a project of its own each |
   | `Newtonsoft.Json`, `StructureMap`, the 15 `AWSSDK.*`, and `CommandLine` (in the `CommandLineParser` package) | `nuget-package`: the 15 `AWSSDK.*` and `CommandLine` found through `Watchman.deps.json` ([#47](https://github.com/adrianeyre/xray/issues/47)) |
   | every other | `framework` |

   A reference resolved otherwise, a new one, or one gone is a failure, named with Dependency Resolution's reason. The expectation is `EXPECTED_RECONSTRUCTION` in [`packages/core/src/real-app/real-app.ts`](../../packages/core/src/real-app/real-app.ts); when a gap is closed and the outcome improves, it is updated with the change that closed it.
3. **Its behaviour.** The original app and the one `dotnet build` built from the Recovered Solution are each run, as `dotnet Watchman.dll …`, over the same inputs, and must write the same stdout and stderr and exit with the same code, as a Round-trip compares them:

   | Arguments | What the original does | Exit code |
   | --- | --- | ---: |
   | `--help` | prints its name, version (`2.0.0+6360ec8…`), copyright and usage, from CommandLineParser and its assembly attributes | 1 |
   | `--version` | prints its name and version | 1 |
   | `--ConfigFolder <folder> --Unknown` | names the unknown option, then prints its usage | 1 |
   | `--RunMode TestConfig --ConfigFolder valid` | loads and validates an alerting group of Lambda functions and SQS queues, with neither AWS nor its credentials | 0 |
   | `… missing-name`, `… missing-suffix` | rejects the alerting group, saying what it lacks | 2 |
   | `… no-files` | finds no configuration file, and says so | 2 |
   | `… malformed` | cannot read a file, saying why, as Newtonsoft.Json told it | 2 |

   The `TestConfig` runs go through all three Sibling Assemblies, StructureMap and Newtonsoft.Json. The configuration folders are written as the smoke test runs (`CONFIGURATIONS`). The original's exit codes are checked too, so that inputs that no longer test what they should are noticed.

   The frames of a stack trace the app prints (`   at Watchman.Configuration.Load.ConfigLoader.LoadConfig() in /_/Watchman.Configuration/Load/ConfigLoader.cs:line 56`) are left out of the comparison: the file and line in each come from the PDB the app was built with, which a rebuilt app cannot have. The message of each exception, and every other line, is compared.

## Running it

```bash
pnpm build:engine
pnpm real-app                  # prints the results as Markdown
pnpm real-app --json out.json  # and writes them as JSON
```

It needs the network, to download the package and to look its references up on nuget.org. It prints the outcome, the projects and their types, how many references were resolved each way, whether each was as expected, and whether each input behaved identically, and exits 1 if anything was not as expected.

CI runs it on every push and pull request as a job of its own, `real app`, on Windows, macOS and Linux. Unlike the benchmark, it blocks a merge: its outcome does not depend on the machine. Its results are in the run's summary, and in its `real-app-<os>` artifact as JSON.

## Results

Run on 2026-10-08 with `pnpm real-app` on Linux 6.17 x64, Node 26.10.0 and .NET SDK 8.0.425:

- a **Full Reconstruction**, targeting `net8.0`: four projects, `Watchman` (9 types), `Watchman.AwsResources` (40), `Watchman.Configuration` (37) and `Watchman.Engine` (83), each laid out by its PDB;
- 28 references: 7 `framework`, 18 `nuget-package`, 3 `sibling-assembly`, none copied and none unresolved, each as expected;
- all 8 inputs behaved identically, stack frames aside;
- 6.8 to 22.3 s in all, over four runs, each with none of its packages in the global-packages cache, of which `dotnet build` took 2.2 to 5.8 s and the resolve dependencies stage 3.8 to 16.0 s, as fast as nuget.org answered. Each of the 18 packages is downloaded once, at the version `Watchman.deps.json` names, which holds the assembly referenced, byte for byte the copy beside `Watchman.dll`.

Before [#47](https://github.com/adrianeyre/xray/issues/47), when Dependency Resolution did not read `Watchman.deps.json`, the 15 `AWSSDK.*` and `CommandLine` were copied binaries, and a Reconstruction took 28 to 64 s, Dependency Resolution 26 to 60 s of it, downloading about 150 versions of the AWS SDK's packages that do not hold the assemblies referenced.

## Gaps found

Choosing the app meant reconstructing others too, each as released on nuget.org. Each gap found has an issue:

| App, as released | Licence | Outcome | Gap |
| --- | --- | --- | --- |
| AwsWatchman ([`JustEatTakeaway.Watchman`](https://www.nuget.org/packages/JustEatTakeaway.Watchman/2.0.0) 2.0.0) | Apache-2.0 | Full | None since [#47](https://github.com/adrianeyre/xray/issues/47); before it, its AWS SDK and CommandLineParser packages were copied binaries, as Dependency Resolution did not read `Watchman.deps.json`, which names them |
| MinVer ([`minver-cli`](https://www.nuget.org/packages/minver-cli/8.0.0) 8.0.0) | Apache-2.0 | Full | None since [#48](https://github.com/adrianeyre/xray/issues/48); before it, `NuGet.Versioning` and `System.CommandLine`, Microsoft's packages, were left to the target framework, which does not provide them |
| XmlSchemaClassGenerator ([`dotnet-xscgen`](https://www.nuget.org/packages/dotnet-xscgen/3.0.1405) 3.0.1405) | Apache-2.0 | Full | None since [#48](https://github.com/adrianeyre/xray/issues/48); before it, `System.CodeDom`, likewise |
| P ([`p`](https://www.nuget.org/packages/p/3.1.0) 3.1.0) | MIT | Full | None since [#49](https://github.com/adrianeyre/xray/issues/49); before it, a `[GeneratedRegex]` method was decompiled with the regex source generator's code and kept the attribute, so the generator refused it (`SYSLIB1043`) |
| BundlerMinifier ([`BundlerMinifier.Core.Tool`](https://www.nuget.org/packages/BundlerMinifier.Core.Tool/8.0.3) 8.0.3) | Apache-2.0 | Full | None since [#50](https://github.com/adrianeyre/xray/issues/50); before it, a query in the select clause a query continuation follows was decompiled without parentheses, so C# read the continuation as that query's (`CS1931`) |
| ReportGenerator ([`dotnet-reportgenerator-globaltool`](https://www.nuget.org/packages/dotnet-reportgenerator-globaltool/5.5.11) 5.5.11) | Apache-2.0 | Full | None; its library, `ReportGenerator.Core`, is published as a package, so it is one |
| XAML Styler ([`XamlStyler.Console`](https://www.nuget.org/packages/XamlStyler.Console/3.2501.8) 3.2501.8) | Apache-2.0 | Full | None; its library, strong-named where the app is not, is copied as a third party's would be (FR-10.4) |
| SingleFileExtractor ([`sfextract`](https://www.nuget.org/packages/sfextract/2.3.0) 2.3.0), NSwag ([`NSwag.ConsoleCore`](https://www.nuget.org/packages/NSwag.ConsoleCore/14.7.1) 14.7.1) | MIT | Full | None; each is a program of a type or two over packages of its own |

Most real .NET apps use one of Microsoft's packages that .NET does not provide (`Microsoft.Extensions.*`, `System.CommandLine`…). Until [#48](https://github.com/adrianeyre/xray/issues/48), that was the gap that most often stood between one and a Full Reconstruction: such a reference is now the framework's only where the reference assemblies of the target framework hold it ([The framework](xray-reconstruct.md#the-framework)), and otherwise a NuGet package.
