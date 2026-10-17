# `xray-report.json`

Every Reconstruction writes `xray-report.json` into its Recovered Solution, beside the `.sln` (PRD FR-16): what went in, what the Assembly is, whether it is obfuscated, what was written, how it built, how its program ran (with `--run`), how long each stage took, and the outcome. It is for scripts and CI to parse (scenario 4) and for the UI to show; `xray reconstruct` prints a summary of the same document (FR-17).

```bash
xray reconstruct MyApp.dll -o ./out
jq -r .outcome ./out/xray-report.json        # full, partial or unverified
```

It is written whatever the outcome — a Full Reconstruction, a Partial one, or one left unverified by `--no-build` — after the build, and after running the program with `--run`, so it can say how they went. When there is no Recovered Solution there is no report: input that is not a Managed Assembly is rejected and nothing is written, and when Xray cannot finish (exit code 1) the exit code and stderr say why. See [`xray reconstruct`](xray-reconstruct.md) for the exit codes.

It holds no path to the Recovered Solution itself (every path in it is relative to its folder) so it stays true when the folder is moved or zipped. It does hold the absolute paths of the input Assembly, of its Sibling Assemblies, and of the binaries copied from beside it.

## Stability

`schemaVersion` is `1`. Within a schema version:

- every field below stays, with the same name, type and meaning;
- new fields may be added, and new values may be added to a field documented as an enumeration, so ignore fields you do not know and treat an unknown enumeration value as "other";
- object keys come in the order shown, but do not rely on key order.

Removing or renaming a field, or changing its type or meaning, increments `schemaVersion`. The `inspect` field follows the [`xray inspect --json`](xray-inspect-json.md) schema: a change that would bump that schema's version bumps this one too.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer | The version of this schema: `1`. |
| `outcome` | string | Enumeration: `full` (a Full Reconstruction: the Recovered Solution built, and, with `--run`, its program did not crash, time out or fail to start), `partial` (a Partial Reconstruction: it was written, but has an Unresolved Dependency, built or not, or did not build, or its program crashed, timed out or failed to start), or `unverified` (`--no-build`: not built, and with no Unresolved Dependency, so neither). |
| `reasons` | object[] | Why the Reconstruction is Partial, one entry per reason; empty unless `outcome` is `partial`. |
| `reasons[].kind` | string | Enumeration. `unresolved-dependencies`: nothing satisfies some of the references, each an Unresolved Dependency (FR-10.5); it comes first, and is given whether the Recovered Solution was built or not, as it cannot build as the original did. `build-failed`: the Recovered Solution did not build. `run-failed`: it built, but its program, run with `--run`, crashed, timed out or failed to start; `run` says which, and why. More kinds may be added, as the Stability section allows, such as for behaviour that does not match the original's. |
| `reasons[].dependencies` | object[] | For `unresolved-dependencies`: each Unresolved Dependency, in the order it was met, exactly as `dependencies` gives it (below). |
| `reasons[].errors` | diagnostic[] | For `build-failed`: the build's errors (see [Diagnostics](#diagnostics)), in the order printed. Empty when the build failed without reporting one, as when it was stopped for taking more than 10 minutes; `build.output` then says why. |
| `inputs` | object | What the Reconstruction was given. |
| `inputs.path` | string | The Assembly, as an absolute path; given a folder, the Assembly in it that was reconstructed (see [`xray reconstruct`](xray-reconstruct.md#what-it-does)). |
| `inputs.options` | object | The options it ran with. |
| `inputs.options.build` | boolean | Whether the Recovered Solution was to be built: `false` with `--no-build`. |
| `inputs.options.run` | boolean | Whether its program was to be run: `true` with `--run`. |
| `inputs.options.siblings` | boolean | Whether Sibling Assemblies were to be reconstructed: `false` with `--no-siblings`, or with the option turned off in `xray ui`. |
| `inputs.options.offline` | boolean | Whether nuget.org was left alone, and `dotnet build` restored only from the global-packages folder: `true` with `--offline`. Always `false` from `xray ui`. |
| `inspect` | object | The Assembly's metadata summary, exactly as [`xray inspect --json`](xray-inspect-json.md) prints it, without its `schemaVersion`. |
| `obfuscated` | boolean | Whether the Assembly is flagged as obfuscated (FR-3): `true` when `inspect.obfuscation.status` is `obfuscated`, whose `indicators` say why. It is reconstructed all the same, as it is, never deobfuscated, with a `warnings` entry; see [Obfuscation](xray-reconstruct.md#obfuscation). |
| `dependencies` | object[] | Every reference of every Assembly of the Recovered Solution (the input's, each Sibling Assembly's), once by name, ignoring case, and how Dependency Resolution satisfied it, or did not (FR-10): in the order met, each Assembly's references by name, the input's first. A copied binary's own references are not looked through. See [Dependency Resolution](xray-reconstruct.md#dependency-resolution). How each NuGet package was looked up is in `packages`; the projects of the Sibling Assemblies, in `solution.projects`. |
| `dependencies[].reference` | object | The reference, as the first Assembly making it records it. |
| `dependencies[].reference.name` | string | The assembly's name, e.g. `System.Runtime`. |
| `dependencies[].reference.version` | string | Its four-part version, e.g. `8.0.0.0`. |
| `dependencies[].reference.culture` | string \| null | `null` for the neutral culture. |
| `dependencies[].reference.publicKeyToken` | string \| null | Lower-case hex, or `null` when it is not strong-named. |
| `dependencies[].referencedBy` | string[] | The names of the Assemblies of the solution making it, in the order they were looked through. |
| `dependencies[].resolution` | string | Enumeration, how it was satisfied, each step in the order Dependency Resolution tries them: `framework` (signed with one of Microsoft's keys, and held by the reference assemblies of the target framework of the Assembly making it, at its version or later, so .NET's own, left to the target framework; or one Xray could not tell of, as when those reference assemblies were not found), `nuget-package` (a NuGet package holds it: a `PackageReference`), `sibling-assembly` (the application's own Assembly beside the input, reconstructed as a project of its own: a `ProjectReference`; or the input itself, referenced back), `copied-binary` (an Assembly beside the input that is not reconstructed, copied into `Dependencies/`: a `Reference` with a `HintPath`) or `unresolved` (nothing satisfies it: an Unresolved Dependency, which makes the Reconstruction Partial). |
| `dependencies[].package` | object \| null | For `nuget-package`, the package referenced; otherwise `null`. |
| `dependencies[].package.id` | string | Its id, e.g. `Newtonsoft.Json`. |
| `dependencies[].package.version` | string | Its version, e.g. `13.0.3`. |
| `dependencies[].projectPath` | string \| null | For `sibling-assembly`, the project that recovers it, relative to the Recovered Solution's folder with `/` between segments, e.g. `Inventory/Inventory.csproj`; otherwise `null`. |
| `dependencies[].copiedTo` | string \| null | For `copied-binary`, where it was copied to, relative as `projectPath` is, e.g. `Dependencies/Kestrelwood.Checksums.dll`; otherwise `null`. |
| `dependencies[].path` | string \| null | For `sibling-assembly` and `copied-binary`, the Assembly beside the input, as an absolute path; otherwise `null`. |
| `dependencies[].reason` | string | Why, for people, e.g. `System.Runtime 8.0.0.0 is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), and net8.0, the target framework of Arithmetic, provides it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Runtime 8.0.0.0. It is left to the target framework.` For `nuget-package` it is `packages[].reason`; for `unresolved`, why no package holds it, then that nothing beside the input does. For a reference to one of Microsoft's assemblies that is not `framework`, it first says why the target framework does not provide it, e.g. `NuGet.Versioning 7.3.0.0 is signed with one of Microsoft's keys (public key token 31bf3856ad364e35), but net8.0, the target framework of minver, does not provide it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds no assembly named NuGet.Versioning. So it is one of Microsoft's packages, looked up as any other, though never reconstructed as a Sibling Assembly.` |
| `siblingProblems` | object[] | What Xray worked around in the Sibling Assemblies, one entry each, in the order it met them; empty when there was nothing. None of them stops the Reconstruction. |
| `siblingProblems[].kind` | string | Enumeration. `duplicate-assembly-name`: more than one Managed Assembly beside the input has the name a reference asks for; one is reconstructed, or copied, and the others are not. `cyclic-reference`: Assemblies reference one another in a cycle, which projects cannot (MSBuild refuses a `ProjectReference` cycle); the reference that closes it gets no `ProjectReference`, so the project making it does not build, and the Reconstruction is Partial. |
| `siblingProblems[].name` | string | For `duplicate-assembly-name`: the name, as the reference gives it, e.g. `Inventory`. |
| `siblingProblems[].paths` | string[] | For `duplicate-assembly-name`: each Assembly of that name, as an absolute path, the one reconstructed first. |
| `siblingProblems[].chosen` | string | For `duplicate-assembly-name`: the one reconstructed, or copied, as the runtime would load it: the `.dll`, then the first by path. |
| `siblingProblems[].cycle` | string[] | For `cyclic-reference`: the names of the Assemblies in the cycle, each referencing the next, the first again last, e.g. `["CyclicReference", "Plugin", "CyclicReference"]`. |
| `siblingProblems[].omitted` | object | For `cyclic-reference`: the reference left out. |
| `siblingProblems[].omitted.from` | string | The name of the Assembly making it, whose project does not build. |
| `siblingProblems[].omitted.to` | string | The name of the Assembly it names. |
| `siblingProblems[].message` | string | What happened, for people, as `xray reconstruct` prints it. |
| `packages` | object[] | Each reference looked up as a NuGet package (FR-10.2), once whichever Assembly makes it, in the order it was: whether a package holds it or not. A reference to one of Microsoft's assemblies is the framework's, and is never looked up. See [NuGet packages](xray-reconstruct.md#nuget-packages). |
| `packages[].reference` | object | The reference, as the Assembly making it records it. |
| `packages[].reference.name` | string | The assembly's name, e.g. `Newtonsoft.Json`, which is the id of the package looked for. |
| `packages[].reference.version` | string | Its four-part version, e.g. `13.0.0.0`: the assembly's, not a package's. |
| `packages[].reference.culture` | string \| null | `null` for the neutral culture. |
| `packages[].reference.publicKeyToken` | string \| null | Lower-case hex, or `null` when it is not strong-named. |
| `packages[].referencedBy` | string[] | The names of the Assemblies of the solution whose projects reference the package chosen; empty when there is none. |
| `packages[].package` | object \| null | The package chosen, referenced with a `PackageReference`; `null` when none holds the assembly, and the reference fell through to the next step: a Sibling Assembly, a copied binary, or nothing, as `dependencies` says. |
| `packages[].package.id` | string | Its id, as the reference names the assembly. |
| `packages[].package.version` | string | Its version, e.g. `13.0.3`, as the `PackageReference` gives it. |
| `packages[].package.source` | string | Enumeration, where it was found: `global-packages` (the local cache, NuGet's global-packages folder) or `nuget.org`. |
| `packages[].package.file` | string | The assembly in it that matched, with `/` between segments, e.g. `lib/net6.0/Newtonsoft.Json.dll`. |
| `packages[].package.matchesCopyBeside` | boolean | Whether that file is, byte for byte, the copy of the assembly beside the input. |
| `packages[].candidates` | object[] | Every version found to hold the assembly, in order of preference, the one chosen first: more than one when the choice was ambiguous. Each has the fields of `package`. Empty when there is none. |
| `packages[].candidates[].id` | string | As `package.id`. |
| `packages[].candidates[].version` | string | As `package.version`. |
| `packages[].candidates[].source` | string | As `package.source`. |
| `packages[].candidates[].file` | string | As `package.file`. |
| `packages[].candidates[].matchesCopyBeside` | boolean | As `package.matchesCopyBeside`. |
| `packages[].searched` | string[] | Where it was looked for, in order: `global-packages`, then `nuget.org`, which is not asked with `--offline` or once the cache has a package holding it. Empty when it was not looked up at all, as for an assembly that is not strong-named with no copy of it beside the input. |
| `packages[].reason` | string | Why that package was chosen, of how many, or why there is none, for people, e.g. `2 versions of Newtonsoft.Json in the global-packages cache hold Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed: 13.0.3, 13.0.9. 13.0.3 is chosen, as its lib/net6.0/Newtonsoft.Json.dll is the very file beside the input (/home/me/app/Newtonsoft.Json.dll). /home/me/app/NuGetDependencies.deps.json says the application's Newtonsoft.Json is from Newtonsoft.Json 13.0.3.` |
| `warnings` | object[] | What went less well than it might have, though it does not make the Reconstruction Partial, one entry each, in the order of the Assemblies they are about, the input's first; empty when there was nothing. |
| `warnings[].kind` | string | Enumeration. `pdb-ignored`: a PDB beside an Assembly was not its own, being another build's or one the Assembly does not record, or could not be read, so it was not used, and that Assembly's locals are named, and its files laid out, as without one. `obfuscated`: an Assembly is likely obfuscated, as its project's `obfuscation` says, and was reconstructed as it is, so its project has the names and strings the obfuscator left. `best-effort-target-framework`: an Assembly targets a framework Xray supports only on a best-effort basis (FR-8), such as .NET Framework 2.0 or 3.5, or `netstandard`, as its `targetFramework.support` in [`xray inspect --json`](xray-inspect-json.md#fields) would say, so its project targets that framework as it is, but is less certain to build and behave like the original; the message says how the framework was told when the Assembly has no `TargetFrameworkAttribute` (see [Target frameworks supported on a best-effort basis](xray-reconstruct.md#target-frameworks-supported-on-a-best-effort-basis)). `resource-kept-as-is`: a `.resources` file of an Assembly, or of a satellite assembly beside it, holds something a `.resx` built by the .NET SDK cannot hold again, so it is embedded as it is, byte for byte, rather than written as a `.resx`; the rebuilt Assembly holds it all the same. `resource-not-recovered`: a resource of an Assembly is linked, kept in another file or assembly, rather than embedded, so the rebuilt Assembly does not have it (see [Resources](xray-reconstruct.md#resources)). `reference-assemblies-not-found`: an Assembly uses Windows Forms or WPF, which this OS has not, and the reference assemblies of its framework were found neither in the global-packages folder nor, unless offline, on nuget.org, so it was decompiled without them, less precisely (see [Windows Forms](xray-reconstruct.md#windows-forms)). `xaml-not-recovered`: an Assembly's WPF resources hold BAML that was not decompiled to XAML, or could not be split back into their files, so they are kept as the BAML they are, and its project has no XAML; the message says why, and whether its classes still hold the code that loads that BAML (see [WPF](xray-reconstruct.md#wpf)). An Assembly's `pdb-ignored` comes before its `obfuscated`, both before its `best-effort-target-framework`, that before its `reference-assemblies-not-found`, that before its `xaml-not-recovered`, and that before its resources', in the order of its `resources`. More kinds may be added. |
| `warnings[].assemblyPath` | string | The Assembly it is about, as an absolute path; for a resource of a satellite assembly, the Assembly whose it is. |
| `warnings[].pdbPath` | string | For `pdb-ignored`: the PDB ignored, as an absolute path. |
| `warnings[].message` | string | What happened, for people, as `xray reconstruct` prints it on stderr after `Warning:`. |
| `solution` | object | The Recovered Solution that was written. |
| `solution.solutionPath` | string | The `.sln`, relative to the Recovered Solution's folder with `/` between segments, e.g. `Arithmetic.sln`. |
| `solution.projectPath` | string | The input Assembly's `.csproj`, relative as `solutionPath` is, e.g. `Arithmetic/Arithmetic.csproj`. |
| `solution.targetFramework` | string | That project's `<TargetFramework>`, the original's, e.g. `net8.0`, with `-windows` where Windows Forms needs it (see [Windows Forms](xray-reconstruct.md#windows-forms)). |
| `solution.outputType` | string | Enumeration, that project's `<OutputType>`: `Exe`, `WinExe` or `Library`. |
| `solution.typeCount` | integer | How many of the input Assembly's top-level types were decompiled. |
| `solution.sourceFileCount` | integer | How many source files they were decompiled to: one for each type, laid out by namespace, but one for each of the original's source files where its PDB was used (see [PDBs](xray-reconstruct.md#pdbs)), and a file-scoped type is in the file of the types that use it. |
| `solution.projects` | object[] | Every project of the solution: the input Assembly's first, then each Sibling Assembly's, in the order they were found. |
| `solution.projects[].assemblyPath` | string | The Assembly it recovers, as an absolute path. |
| `solution.projects[].assemblyName` | string | Its name, which the project and its folder take. |
| `solution.projects[].projectPath` | string | The `.csproj`, relative as `solutionPath` is, e.g. `Inventory/Inventory.csproj`. |
| `solution.projects[].targetFramework` | string | Its `<TargetFramework>`, the original's. |
| `solution.projects[].outputType` | string | Enumeration, its `<OutputType>`: `Exe`, `WinExe` or `Library`. |
| `solution.projects[].typeCount` | integer | How many top-level types were decompiled, as `solution.typeCount` counts them. |
| `solution.projects[].sourceFileCount` | integer | How many source files they were decompiled to, as `solution.sourceFileCount` counts them. |
| `solution.projects[].pdb` | object | The PDB beside the Assembly, and whether it was used (FR-4), as `inspect.pdb` gives it for the input Assembly (see [`xray inspect --json`](xray-inspect-json.md#fields)): only the Assembly's own is used. |
| `solution.projects[].pdb.status` | string | Enumeration: `none`, `matching` (used), `mismatched` or `unreadable` (each ignored, with a `warnings` entry). |
| `solution.projects[].pdb.path` | string | The PDB, as an absolute path; absent for `none`. |
| `solution.projects[].pdb.format` | string \| null | Enumeration: `portable` or `windows`; `null` for a file that is a PDB of neither; absent for `none`. |
| `solution.projects[].pdb.reason` | string | For `mismatched` and `unreadable`: why it was ignored. |
| `solution.projects[].obfuscation` | object | Whether the Assembly shows signs of obfuscation (FR-3), as `inspect.obfuscation` gives it for the input Assembly (see [`xray inspect --json`](xray-inspect-json.md#fields)). |
| `solution.projects[].obfuscation.status` | string | Enumeration: `clean` or `obfuscated` (reconstructed as it is, with a `warnings` entry). |
| `solution.projects[].obfuscation.indicators` | object[] | Each sign found; empty when `clean`. |
| `solution.projects[].obfuscation.indicators[].kind` | string | Enumeration: `obfuscator-attribute`, `mangled-identifiers` or `encrypted-strings`. |
| `solution.projects[].obfuscation.indicators[].evidence` | string[] | What was found, as it is: an attribute's full name, names, or the types holding the string decoders called. |
| `solution.projects[].obfuscation.indicators[].message` | string | What was found, and how much of it, for people. |
| `solution.projects[].projectReferences` | string[] | The projects of the Sibling Assemblies it references, each a `ProjectReference`, by their `projectPath`. |
| `solution.projects[].packageReferences` | object[] | The NuGet packages it references, each a `PackageReference`, in the order of its Assembly's references. |
| `solution.projects[].packageReferences[].id` | string | The package's id, e.g. `Newtonsoft.Json`. |
| `solution.projects[].packageReferences[].version` | string | Its version, e.g. `13.0.3`. |
| `solution.projects[].binaryReferences` | string[] | The binaries copied into the Recovered Solution that it references, each a `Reference` with a `HintPath`, by where they were copied to, relative as `solutionPath` is, e.g. `Dependencies/Kestrelwood.Checksums.dll`. |
| `solution.projects[].resources` | object[] | Every resource of its Assembly's manifest, in metadata order, then every resource of each of its satellite assemblies, in order of their culture, and what became of it (FR-12); empty when there is none. See [Resources](xray-reconstruct.md#resources). |
| `solution.projects[].resources[].name` | string | Its logical name, as the original's manifest gives it, and the rebuilt Assembly's does too, e.g. `Phrasebook.Strings.resources`. |
| `solution.projects[].resources[].culture` | string \| null | The culture of the satellite assembly it is in, as that records it, e.g. `fr`; `null` for the Assembly's own. |
| `solution.projects[].resources[].public` | boolean | Whether it is public, rather than private to its Assembly, as it was, and is again. |
| `solution.projects[].resources[].recoveredAs` | string | Enumeration: `resx` (a `.resources` file written as a `.resx`, which the build compiles back to it), `file` (embedded as it is, byte for byte), `not-recovered` (a linked resource, in another file or assembly, which the rebuilt Assembly does not have, with a `warnings` entry) or `xaml` (WPF resources, `<Name>.g.resources`, split back into the XAML files their BAML was decompiled to and the `Resource` files they held, which the build compiles back to them; see [WPF](xray-reconstruct.md#wpf)). More values may be added. |
| `solution.projects[].resources[].path` | string \| null | The file it is embedded from, relative as `solutionPath` is, e.g. `Phrasebook/Strings.fr.resx`; `null` for `not-recovered`, and for `xaml`, which is many files, listed in `solution.files`. |
| `solution.projects[].resources[].reason` | string \| null | For a `.resources` file embedded as it is rather than written as a `.resx`, why, e.g. `Its entry "MaxPhrases" is a System.Int32, not a string, a byte[] or a stream.`, with a `warnings` entry; for `not-recovered`, why; otherwise `null`. |
| `solution.files` | string[] | Every file Xray wrote, relative as `solutionPath` is, the binaries it copied into `Dependencies/` after the rest, this report last. Not what `dotnet build` wrote in `bin/` and `obj/`. |
| `build` | object \| null | How `dotnet build` verified the Recovered Solution; `null` when it was not built (`--no-build`). |
| `build.succeeded` | boolean | Whether it built. |
| `build.diagnostics` | diagnostic[] | Every error and warning it printed, once each, in the order printed (see [Diagnostics](#diagnostics)). |
| `build.output` | string | Everything `dotnet build` printed, stdout then stderr. |
| `run` | object \| null | What the rebuilt program did when it was run, or why it was not (FR-14); `null` when it was not asked to run (no `--run`). See [Run](xray-reconstruct.md#run). |
| `run.status` | string | Enumeration: `exited` (it exited on its own, whatever its exit code), `launched` (a Windows GUI program, still running 5 s after it started, then closed), `skipped` (it cannot run here; `reason` says why), `crashed`, `timed-out` (a console program still running after 60 s, then stopped) or `failed-to-start`. The last three make the Reconstruction Partial. |
| `run.reason` | string \| null | Why it was skipped, crashed, timed out or failed to start, e.g. `It is a WinForms program, and WinForms runs only on Windows, not on Linux.`; `null` when it exited or launched. |
| `run.program` | string \| null | The program run, relative to the Recovered Solution's folder with `/` between segments, e.g. `Arithmetic/bin/Debug/net8.0/Arithmetic.dll`; `null` when it was skipped. |
| `run.exitCode` | integer \| null | Its exit code when it exited, or crashed with one (as on Windows); otherwise `null`. Not judged: a non-zero exit code does not make the Reconstruction Partial. |
| `run.stdout` | string \| null | What it wrote to stdout, up to its first MiB; `null` when it was skipped. |
| `run.stderr` | string \| null | What it wrote to stderr, as `stdout`; `null` when it was skipped. |
| `timings` | object | How long each stage took, in whole milliseconds. |
| `timings.analyse` | integer | Choosing the Assembly in a folder, if given one, starting the engine, classifying the input, checking the output directory and inspecting the Assembly. |
| `timings.decompile` | integer | Decompiling every type of the Assembly to C#. |
| `timings.resolveDependencies` | integer \| null | Dependency Resolution: looking references up as NuGet packages, finding the Sibling Assemblies, decompiling each, and stopping the engine. It is no longer skipped, even with `--no-siblings`, so is not `null`. |
| `timings.generate` | integer | Laying out the Recovered Solution and writing it. |
| `timings.build` | integer \| null | `dotnet build`; `null` when it was not built. |
| `timings.run` | integer \| null | Running the rebuilt program; `null` when it was not run (no `--run`, or skipped). |
| `timings.total` | integer | The whole Reconstruction, up to writing this report. |

## Diagnostics

Each error or warning `dotnet build` printed, mapped to the Recovered Solution, as `build.diagnostics[]` and `reasons[].errors[]` give them:

| Field | Type | Meaning |
|---|---|---|
| `severity` | string | Enumeration: `error` or `warning`. |
| `code` | string | The compiler's or tool's code, such as `CS0246`; empty if it gave none. |
| `message` | string | What it says, without the project the build appends. |
| `file` | string | The file it is about, relative to the Recovered Solution's folder with `/` between segments, such as `MissingReference/Program.cs`. A file outside it (an SDK targets file, say) keeps the absolute path the build printed. Absent when it names no file. |
| `line` | integer | 1-based; absent when it gives none. |
| `column` | integer | 1-based; absent when it gives none. |
| `project` | string | The project being built, relative as `file` is; absent when it names none. |

## Example

The arithmetic Fixture (`fixtures/arithmetic`), a .NET 8 console program, reconstructed with `xray reconstruct … -o /home/me/out`: a Full Reconstruction. `build.output` and `timings` differ from run to run.

```json
{
  "schemaVersion": 1,
  "outcome": "full",
  "reasons": [],
  "inputs": {
    "path": "/home/me/xray/fixtures/.cache/arithmetic/bin/Arithmetic/release/Arithmetic.dll",
    "options": {
      "build": true,
      "run": false,
      "siblings": true,
      "offline": false
    }
  },
  "inspect": {
    "path": "/home/me/xray/fixtures/.cache/arithmetic/bin/Arithmetic/release/Arithmetic.dll",
    "assembly": {
      "name": "Arithmetic",
      "version": "1.0.0.0",
      "culture": null,
      "publicKeyToken": null
    },
    "targetFramework": {
      "moniker": "net8.0",
      "frameworkName": ".NETCoreApp,Version=v8.0",
      "runtimeVersion": "v4.0.30319",
      "inferredFrom": null,
      "support": "full"
    },
    "architecture": {
      "platformTarget": "AnyCPU",
      "prefer32Bit": false,
      "bitness": "any",
      "machine": "I386"
    },
    "entryPoint": {
      "type": "Arithmetic.Program",
      "method": "Main"
    },
    "outputKind": "console",
    "references": [
      {
        "name": "System.Console",
        "version": "8.0.0.0",
        "culture": null,
        "publicKeyToken": "b03f5f7f11d50a3a"
      },
      {
        "name": "System.Runtime",
        "version": "8.0.0.0",
        "culture": null,
        "publicKeyToken": "b03f5f7f11d50a3a"
      }
    ],
    "counts": {
      "types": 1,
      "methods": 9,
      "resources": 0
    },
    "pdb": {
      "status": "matching",
      "path": "/home/me/xray/fixtures/.cache/arithmetic/bin/Arithmetic/release/Arithmetic.pdb",
      "format": "portable"
    },
    "obfuscation": {
      "status": "clean",
      "indicators": []
    }
  },
  "obfuscated": false,
  "dependencies": [
    {
      "reference": {
        "name": "System.Console",
        "version": "8.0.0.0",
        "culture": null,
        "publicKeyToken": "b03f5f7f11d50a3a"
      },
      "referencedBy": [
        "Arithmetic"
      ],
      "resolution": "framework",
      "package": null,
      "projectPath": null,
      "copiedTo": null,
      "path": null,
      "reason": "System.Console 8.0.0.0 is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), and net8.0, the target framework of Arithmetic, provides it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Console 8.0.0.0. It is left to the target framework."
    },
    {
      "reference": {
        "name": "System.Runtime",
        "version": "8.0.0.0",
        "culture": null,
        "publicKeyToken": "b03f5f7f11d50a3a"
      },
      "referencedBy": [
        "Arithmetic"
      ],
      "resolution": "framework",
      "package": null,
      "projectPath": null,
      "copiedTo": null,
      "path": null,
      "reason": "System.Runtime 8.0.0.0 is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), and net8.0, the target framework of Arithmetic, provides it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Runtime 8.0.0.0. It is left to the target framework."
    }
  ],
  "siblingProblems": [],
  "packages": [],
  "warnings": [],
  "solution": {
    "solutionPath": "Arithmetic.sln",
    "projectPath": "Arithmetic/Arithmetic.csproj",
    "targetFramework": "net8.0",
    "outputType": "Exe",
    "typeCount": 1,
    "sourceFileCount": 1,
    "projects": [
      {
        "assemblyPath": "/home/me/xray/fixtures/.cache/arithmetic/bin/Arithmetic/release/Arithmetic.dll",
        "assemblyName": "Arithmetic",
        "projectPath": "Arithmetic/Arithmetic.csproj",
        "targetFramework": "net8.0",
        "outputType": "Exe",
        "typeCount": 1,
        "sourceFileCount": 1,
        "pdb": {
          "status": "matching",
          "path": "/home/me/xray/fixtures/.cache/arithmetic/bin/Arithmetic/release/Arithmetic.pdb",
          "format": "portable"
        },
        "obfuscation": {
          "status": "clean",
          "indicators": []
        },
        "projectReferences": [],
        "packageReferences": [],
        "binaryReferences": [],
        "resources": []
      }
    ],
    "files": [
      "Arithmetic.sln",
      "Arithmetic/Arithmetic.csproj",
      "Arithmetic/Properties/AssemblyInfo.cs",
      "Arithmetic/Program.cs",
      "xray-report.json"
    ]
  },
  "build": {
    "succeeded": true,
    "diagnostics": [],
    "output": "  Determining projects to restore...\n  Restored /home/me/out/Arithmetic/Arithmetic.csproj (in 62 ms).\n  Arithmetic -> /home/me/out/Arithmetic/bin/Debug/net8.0/Arithmetic.dll\n\nBuild succeeded.\n    0 Warning(s)\n    0 Error(s)\n\nTime Elapsed 00:00:00.83\n"
  },
  "run": null,
  "timings": {
    "analyse": 86,
    "decompile": 615,
    "resolveDependencies": 6,
    "generate": 2,
    "build": 994,
    "run": null,
    "total": 1703
  }
}
```

For the `missing-reference` Fixture, whose class library is missing, the Reconstruction is Partial and says why: `Greetings` is an Unresolved Dependency, and the build fails without it:

```json
{
  "schemaVersion": 1,
  "outcome": "partial",
  "reasons": [
    {
      "kind": "unresolved-dependencies",
      "dependencies": [
        {
          "reference": {
            "name": "Greetings",
            "version": "1.0.0.0",
            "culture": null,
            "publicKeyToken": null
          },
          "referencedBy": [
            "MissingReference"
          ],
          "resolution": "unresolved",
          "package": null,
          "projectPath": null,
          "copiedTo": null,
          "path": null,
          "reason": "Greetings is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of Greetings 1.0.0.0, not strong-named beside it, so no package was looked for. No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it."
        }
      ]
    },
    {
      "kind": "build-failed",
      "errors": [
        {
          "severity": "error",
          "code": "CS0246",
          "message": "The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)",
          "file": "MissingReference/Program.cs",
          "line": 2,
          "column": 7,
          "project": "MissingReference/MissingReference.csproj"
        }
      ]
    }
  ],
  …
}
```

For the `multi-assembly` Fixture, whose two class libraries are beside it, each Sibling Assembly is a project of its own in `solution.projects`, after the program's, which references them both. Each was built with its PDB, so each is decompiled with it, and laid out in the source files it records: the program's two types are both in its `Program.cs`:

```json
[
  {
    "assemblyPath": "/home/me/app/MultiAssembly.dll",
    "assemblyName": "MultiAssembly",
    "projectPath": "MultiAssembly/MultiAssembly.csproj",
    "targetFramework": "net8.0",
    "outputType": "Exe",
    "typeCount": 2,
    "sourceFileCount": 1,
    "pdb": {
      "status": "matching",
      "path": "/home/me/app/MultiAssembly.pdb",
      "format": "portable"
    },
    "obfuscation": {
      "status": "clean",
      "indicators": []
    },
    "projectReferences": [
      "Inventory/Inventory.csproj",
      "Pricing/Pricing.csproj"
    ],
    "packageReferences": [],
    "binaryReferences": [],
    "resources": []
  },
  {
    "assemblyPath": "/home/me/app/Inventory.dll",
    "assemblyName": "Inventory",
    "projectPath": "Inventory/Inventory.csproj",
    "targetFramework": "net8.0",
    "outputType": "Library",
    "typeCount": 8,
    "sourceFileCount": 3,
    "pdb": {
      "status": "matching",
      "path": "/home/me/app/Inventory.pdb",
      "format": "portable"
    },
    "obfuscation": {
      "status": "clean",
      "indicators": []
    },
    "projectReferences": [],
    "packageReferences": [],
    "binaryReferences": [],
    "resources": []
  },
  {
    "assemblyPath": "/home/me/app/Pricing.dll",
    "assemblyName": "Pricing",
    "projectPath": "Pricing/Pricing.csproj",
    "targetFramework": "net8.0",
    "outputType": "Library",
    "typeCount": 7,
    "sourceFileCount": 2,
    "pdb": {
      "status": "matching",
      "path": "/home/me/app/Pricing.pdb",
      "format": "portable"
    },
    "obfuscation": {
      "status": "clean",
      "indicators": []
    },
    "projectReferences": [
      "Inventory/Inventory.csproj"
    ],
    "packageReferences": [],
    "binaryReferences": [],
    "resources": []
  }
]
```

For the `cyclic-reference` Fixture, whose program and plugin reference one another, the cycle is reported, and the Reconstruction is Partial, as the plugin's project does not build:

```json
[
  {
    "kind": "cyclic-reference",
    "cycle": [
      "CyclicReference",
      "Plugin",
      "CyclicReference"
    ],
    "omitted": {
      "from": "Plugin",
      "to": "CyclicReference"
    },
    "message": "CyclicReference references Plugin references CyclicReference, a cycle projects cannot have. The reference from Plugin to CyclicReference is left out, so Plugin does not build."
  }
]
```

With `--run`, `inputs.options.run` is `true`, and `run` says what the rebuilt program did. For the arithmetic Fixture, which, given no arguments, prints its usage and exits 1 (a Full Reconstruction all the same):

```json
{
  "status": "exited",
  "reason": null,
  "program": "Arithmetic/bin/Debug/net8.0/Arithmetic.dll",
  "exitCode": 1,
  "stdout": "",
  "stderr": "Usage: Arithmetic <int|long|double|decimal> <left> <right>\n"
}
```

For the `nuget-dependencies` Fixture, which uses Newtonsoft.Json 13.0.3 and Serilog 3.1.1, `packages` says which package holds each assembly, where it was found, and why it was chosen; the program's project references both, in `solution.projects[0].packageReferences`. Here the global-packages cache holds them, and each holds the very file `dotnet build` copied beside the program, in `/home/me/app`:

```json
[
  {
    "reference": {
      "name": "Newtonsoft.Json",
      "version": "13.0.0.0",
      "culture": null,
      "publicKeyToken": "30ad4fe6b2a6aeed"
    },
    "referencedBy": [
      "NuGetDependencies"
    ],
    "package": {
      "id": "Newtonsoft.Json",
      "version": "13.0.3",
      "source": "global-packages",
      "file": "lib/net6.0/Newtonsoft.Json.dll",
      "matchesCopyBeside": true
    },
    "candidates": [
      {
        "id": "Newtonsoft.Json",
        "version": "13.0.3",
        "source": "global-packages",
        "file": "lib/net6.0/Newtonsoft.Json.dll",
        "matchesCopyBeside": true
      }
    ],
    "searched": [
      "global-packages"
    ],
    "reason": "Newtonsoft.Json 13.0.3, in the global-packages cache, holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed as lib/net6.0/Newtonsoft.Json.dll, the very file beside the input (/home/me/app/Newtonsoft.Json.dll). /home/me/app/NuGetDependencies.deps.json says the application's Newtonsoft.Json is from Newtonsoft.Json 13.0.3."
  },
  {
    "reference": {
      "name": "Serilog",
      "version": "2.0.0.0",
      "culture": null,
      "publicKeyToken": "24c2f752a8e58a10"
    },
    "referencedBy": [
      "NuGetDependencies"
    ],
    "package": {
      "id": "Serilog",
      "version": "3.1.1",
      "source": "global-packages",
      "file": "lib/net7.0/Serilog.dll",
      "matchesCopyBeside": true
    },
    "candidates": [
      {
        "id": "Serilog",
        "version": "3.1.1",
        "source": "global-packages",
        "file": "lib/net7.0/Serilog.dll",
        "matchesCopyBeside": true
      }
    ],
    "searched": [
      "global-packages"
    ],
    "reason": "Serilog 3.1.1, in the global-packages cache, holds Serilog 2.0.0.0, public key token 24c2f752a8e58a10 as lib/net7.0/Serilog.dll, the very file beside the input (/home/me/app/Serilog.dll). /home/me/app/NuGetDependencies.deps.json says the application's Serilog is from Serilog 3.1.1."
  }
]
```

For the `copied-binary` Fixture, a program that uses `Kestrelwood.Checksums`, a third party's library no NuGet package holds, strong-named with its vendor's key, `dependencies` says how each reference was satisfied: that library by a copied binary, `Dependencies/Kestrelwood.Checksums.dll`, which the program's project references in `solution.projects[0].binaryReferences`, and the rest by the framework. Here the library was beside the program, in `/home/me/app`:

```json
[
  {
    "reference": {
      "name": "Kestrelwood.Checksums",
      "version": "2.3.1.0",
      "culture": null,
      "publicKeyToken": "51ca75d1f3633191"
    },
    "referencedBy": [
      "CopiedBinary"
    ],
    "resolution": "copied-binary",
    "package": null,
    "projectPath": null,
    "copiedTo": "Dependencies/Kestrelwood.Checksums.dll",
    "path": "/home/me/app/Kestrelwood.Checksums.dll",
    "reason": "No NuGet package was found to hold it. /home/me/app/Kestrelwood.Checksums.dll, beside the input, is strong-named with a key (public key token 51ca75d1f3633191), so it is a third party's, not the application's own: it is copied, not reconstructed, into the Recovered Solution's Dependencies folder, and referenced with a HintPath."
  },
  {
    "reference": {
      "name": "System.Console",
      "version": "8.0.0.0",
      "culture": null,
      "publicKeyToken": "b03f5f7f11d50a3a"
    },
    "referencedBy": [
      "CopiedBinary"
    ],
    "resolution": "framework",
    "package": null,
    "projectPath": null,
    "copiedTo": null,
    "path": null,
    "reason": "System.Console 8.0.0.0 is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), and net8.0, the target framework of CopiedBinary, provides it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Console 8.0.0.0. It is left to the target framework."
  },
  {
    "reference": {
      "name": "System.Runtime",
      "version": "8.0.0.0",
      "culture": null,
      "publicKeyToken": "b03f5f7f11d50a3a"
    },
    "referencedBy": [
      "CopiedBinary"
    ],
    "resolution": "framework",
    "package": null,
    "projectPath": null,
    "copiedTo": null,
    "path": null,
    "reason": "System.Runtime 8.0.0.0 is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), and net8.0, the target framework of CopiedBinary, provides it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Runtime 8.0.0.0. It is left to the target framework."
  }
]
```

With another build's PDB beside it (here, the `copied-binary` Fixture's, named `Arithmetic.pdb`), the arithmetic Fixture is still a Full Reconstruction, but that PDB is ignored, as `inspect.pdb` and its project's `pdb` say, and `warnings` says so:

```json
[
  {
    "kind": "pdb-ignored",
    "assemblyPath": "/home/me/app/Arithmetic.dll",
    "pdbPath": "/home/me/app/Arithmetic.pdb",
    "message": "Ignored the PDB beside Arithmetic.dll, /home/me/app/Arithmetic.pdb. Arithmetic.pdb, a portable PDB, is not Arithmetic.dll's own: its ID is not the one Arithmetic.dll records, so it is another build's. So Arithmetic's local variables are named, and its source files laid out, as without a PDB."
  }
]
```

For the `obfuscated` Fixture, which Obfuscar renames, and whose strings it hides, as it is built, `obfuscated` is `true`, and `inspect.obfuscation` and its project's `obfuscation` say why, as [`xray inspect --json`](xray-inspect-json.md#example) does. It is reconstructed all the same, as it is, and `warnings` says so. Its Recovered Solution has the names Obfuscar gave, some of which C# cannot declare, such as two fields of one type both named `A`, so it does not build, and the Reconstruction is Partial. Here the Assembly was in `/home/me/app`; Obfuscar names the type it hides strings in afresh, by GUIDs, each build:

```json
[
  {
    "kind": "obfuscated",
    "assemblyPath": "/home/me/app/Obfuscated.dll",
    "message": "Obfuscated.dll is likely obfuscated. 79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer. Its strings are hidden: 23 calls fetch them from string decoders, which decode them from bytes (in <PrivateImplementationDetails>{B9661AAF-D5F4-4AD6-9C6B-533D1B6AC7FE}.4C778FB7-5732-4E85-86A3-7EEF367292B7), against 0 literals. It was reconstructed as it is, not deobfuscated: Obfuscated's names and strings are the obfuscator's."
  }
]
```

For the `net35-library` Fixture, a .NET 8 program using `Gradebook`, a .NET Framework 3.5 library beside it, both are reconstructed, each a project for its own framework, and the Reconstruction is Full; `Gradebook`'s framework is one Xray supports only on a best-effort basis, and `warnings` says so, and how its framework was told. Here the program was in `/home/me/app`:

```json
[
  {
    "kind": "best-effort-target-framework",
    "assemblyPath": "/home/me/app/Gradebook.dll",
    "message": "Gradebook.dll targets net35, which Xray supports only on a best-effort basis, not as fully as .NET Framework 4.x, .NET Core 3.1 or .NET 5 and later: Gradebook's project targets it as it is, but it is less certain to build and behave like the original. It records no TargetFrameworkAttribute, as nothing built before .NET Framework 4.0 does, so net35 was told from CLR v2.0.50727 and its reference to System.Core 3.5.0.0."
  }
]
```

For the `resources` Fixture, whose Assembly, `Phrasebook`, has French and German satellite assemblies, its project's `resources` say what became of each of its resources, then of each of theirs: the `.resources` files of strings, `byte[]`s and streams written as `.resx`, each satellite assembly's beside the Assembly's own; the files embedded as they are, one of them private; and `Limits.resources`, embedded as it is too, as it holds an `int`, which `warnings` says too (see [Resources](xray-reconstruct.md#resources)):

```json
[
  {
    "name": "Phrasebook.Images.resources",
    "culture": null,
    "public": true,
    "recoveredAs": "resx",
    "path": "Phrasebook/Images.resx",
    "reason": null
  },
  {
    "name": "Phrasebook.Phrases.Menu.resources",
    "culture": null,
    "public": true,
    "recoveredAs": "resx",
    "path": "Phrasebook/Phrases/Menu.resx",
    "reason": null
  },
  {
    "name": "Phrasebook.Strings.resources",
    "culture": null,
    "public": true,
    "recoveredAs": "resx",
    "path": "Phrasebook/Strings.resx",
    "reason": null
  },
  {
    "name": "Phrasebook.Assets.flag.png",
    "culture": null,
    "public": true,
    "recoveredAs": "file",
    "path": "Phrasebook/Assets.flag.png",
    "reason": null
  },
  {
    "name": "motd",
    "culture": null,
    "public": true,
    "recoveredAs": "file",
    "path": "Phrasebook/motd",
    "reason": null
  },
  {
    "name": "Phrasebook.Secret",
    "culture": null,
    "public": false,
    "recoveredAs": "file",
    "path": "Phrasebook/Phrasebook.Secret",
    "reason": null
  },
  {
    "name": "Phrasebook.Limits.resources",
    "culture": null,
    "public": true,
    "recoveredAs": "file",
    "path": "Phrasebook/Limits.resources",
    "reason": "Its entry \"MaxPhrases\" is a System.Int32, not a string, a byte[] or a stream."
  },
  {
    "name": "Phrasebook.Strings.de.resources",
    "culture": "de",
    "public": true,
    "recoveredAs": "resx",
    "path": "Phrasebook/Strings.de.resx",
    "reason": null
  },
  {
    "name": "Phrasebook.Phrases.Menu.fr.resources",
    "culture": "fr",
    "public": true,
    "recoveredAs": "resx",
    "path": "Phrasebook/Phrases/Menu.fr.resx",
    "reason": null
  },
  {
    "name": "Phrasebook.Strings.fr.resources",
    "culture": "fr",
    "public": true,
    "recoveredAs": "resx",
    "path": "Phrasebook/Strings.fr.resx",
    "reason": null
  },
  {
    "name": "Phrasebook.Assets.notes.txt",
    "culture": "fr",
    "public": true,
    "recoveredAs": "file",
    "path": "Phrasebook/Assets.notes.fr.txt",
    "reason": null
  }
]
```
