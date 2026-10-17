# `xray reconstruct`

`xray reconstruct <assembly|folder> -o <dir> [--force] [--no-build] [--run] [--no-siblings] [--offline]` turns a Managed Assembly, with the NuGet packages, Sibling Assemblies and other binaries it references, into a Recovered Solution in `<dir>` (PRD FR-4, FR-7, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-25), then builds it with `dotnet build`, with `--run` runs the program it built, classifies the Reconstruction as Full or Partial, and writes [`xray-report.json`](xray-report-json.md) saying how it went.

It is built for Managed Assemblies for .NET Framework 4.0–4.8.1, .NET Core 3.1 or .NET 5+, and, on a best-effort basis, .NET Framework 2.0/3.5 and `netstandard` (see [Target frameworks supported on a best-effort basis](#target-frameworks-supported-on-a-best-effort-basis)).

## What it does

1. **Chooses the Assembly**, if given a folder, from every file in it and its subfolders, as `xray ui` does an uploaded folder: its only `.exe` or `.dll`; else its only `.dll` with a `.runtimeconfig.json` of the same name beside it (a .NET Core or .NET 5+ application, whose `.exe`, if any, is a native launcher); else its only `.exe` (a .NET Framework application). A folder with none, or with several and nothing saying which is the application's, is refused (exit code 1), listing them, so you can give the one you mean.
2. **Classifies** the input. Anything that is not a Managed Assembly is rejected exactly as by `xray inspect`, and nothing is written.
3. **Checks the output directory.** It must not exist yet, or be empty. A folder that holds anything is refused unless `--force` is given, in which case everything in it is deleted first. Even with `--force`, a folder that holds the input Assembly is refused.
4. **Decompiles** every top-level type to C# 12 with the engine (ICSharpCode.Decompiler), several at once, one on each processor (see [Performance](benchmark.md)), nested types inside their declaring type, with the PDB beside the Assembly if it is the Assembly's own (see [PDBs](#pdbs)). Types the compiler embeds for its own use (`Microsoft.CodeAnalysis.EmbeddedAttribute` and the attributes it marks) are left out. Where the decompiler's C# would not compile, or would do something else, Xray corrects it:
   - A default value is always written `default(T)`, never the bare `default` literal, whose type depends on where it stands: in an interpolation hole it is an `object`, so `$"{default(Point)}"` written as `$"{default}"` would print nothing.
   - A type test (`is` or `as`) that C# can tell is impossible, such as a sealed class tested for an interface it does not implement, gets back the upcast to `object` that its IL does not record: `((object)new Describer<string>()) is IConsumer<object>`.
   - A local holding a lambda whose type is a delegate the compiler made up for it (its natural type, where no `Func` or `Action` fits) is declared with `var`, so the compiler makes the same type again: `var scale = (int value, int by = 3) => value * by;`. Such a delegate that C# cannot declare, as here, where its `T2 arg2 = 3` is a default no type parameter can have (`CS1750`), is left out.
   - A switch expression that matches nothing throws `new SwitchExpressionException(value)` (`InvalidOperationException` where that is not available), rather than calling the helper the compiler added to `<PrivateImplementationDetails>` to throw it, which no source can call (`CS0103`).
   - A copy of a record made with an empty `with` expression is written `record with { }`, not as the call to `<Clone>$()` the compiler makes of it (`CS1061`).
   - A throw expression in a primary constructor's field initializer, `private readonly double kelvin = celsius < -273.15 ? throw … : celsius + 273.15;`, is put back there, so the class keeps its primary constructor, rather than becoming a constructor that checks its argument and then calls `base..ctor()`, which C# cannot (`CS0117`).
   - An array or list indexed from its end is written `values[values.Length - 1]`, not `values[^1]`, unless the framework the Assembly targets has `System.Index`, which index from the end needs: .NET Core 3.0 and later, and .NET Standard 2.1. .NET Framework and .NET Standard 2.0 have not (`CS0518`); the decompiler, which cannot find .NET Framework's own assemblies on any OS, would write it all the same.
   - A record's own `GetHashCode` that returns 0 is kept. The decompiler takes it for the one the compiler writes for a record struct with no fields, and leaves it out; without it, the record hashes as the compiler would have, and a `HashSet` keeps records its own `Equals` calls equal.
   - A query that ends the clause a query continuation follows is parenthesized: `from g in parts select (from t in g select Parse(t)) into g where !g.Contains(null) …`, as `parts.Select(g => g.Select(t => Parse(t))).Where(g => !g.Contains(null))` is decompiled. A query has no token to end it, so without the parentheses C# reads the `into g` as the inner query's, whose range variable then conflicts with the outer `g` (`CS1931`), and the `where` as reading a result of `Parse` (`CS1061`). The continuation may reuse the outer range variable's name, whose scope ends where the continuation begins.
   - A file-scoped type (`file class Format`) is declared `file` again, under its own name, in the file of the types that use it, with the other file-scoped types of its file. The compiler names it after the file it was declared in and a checksum of that file's path, `<Greetings>F1A2B…__Format`; written as an ordinary type of that name, it would be visible outside its file. That file is named after the original (`Greetings.cs`), whatever the types in it are called, so the type's rebuilt name starts `<Greetings>` again.

   Lambdas, local functions, LINQ queries, iterators, async methods and async iterators come back as C#, never as the closure classes and state machines the compiler made of them. Records and record structs come back as records, with their `init` accessors and `with` expressions, and a class or struct with a primary constructor keeps it. Patterns and switch expressions come back as code that matches what they matched, though often as `if` and `switch` statements rather than patterns. Collection expressions come back as the code the compiler made of them (`new List<int>()` and `Add`, an array, a span over an inline array), with the compiler's own `<>z__ReadOnlyArray<T>` and `<>y__InlineArray3<T>` declared as source types under names C# accepts.
   An Assembly that is likely obfuscated is decompiled as it is, with the names and strings the obfuscator left: Xray says so, but never deobfuscates (see [Obfuscation](#obfuscation)).
   It **reads its resources** too, and those of its satellite assemblies beside it (see [Resources](#resources)).
5. **Resolves dependencies,** in the order of FR-10 (see [Dependency Resolution](#dependency-resolution)): each reference that is not [the framework's](#the-framework) is looked up as a [NuGet package](#nuget-packages), and becomes a `PackageReference` if one holds it; failing that, an Assembly of its name beside the input is a [Sibling Assembly](#sibling-assemblies), reconstructed (below), or a [copied binary](#copied-binaries); failing that, it is an [Unresolved Dependency](#unresolved-dependencies).
6. **Writes the Recovered Solution** (below).
7. **Builds** it with `dotnet build <Name>.sln`, its output landing in each project's `bin/` and `obj/` as for anyone who opens it, unless `--no-build` is given. Each error and warning the build prints is mapped to a file and line in the Recovered Solution (below).
8. **Runs** the program it built, only if `--run` is given, as that executes recovered code (below).
9. **Classifies** the outcome (below).
10. **Reports** it: writes `<dir>/xray-report.json` ([schema](xray-report-json.md)), whatever the outcome, and prints a summary of it (below).

Throughout, it shows on stderr how far it has got through the stages of a Reconstruction (below).

## Dependency Resolution

Every reference of every Assembly of the Recovered Solution (the input's, then each Sibling Assembly's) is satisfied by the first of these that can, in the order of FR-10, once by name, whichever Assembly makes it. `dependencies` in `xray-report.json` lists each, how it was satisfied and why; the summary counts them (below); [`xray ui`](xray-ui.md#the-report) shows them as a table.

| Step | Satisfied by | In the Recovered Solution | `resolution` |
|---|---|---|---|
| 1 | [The framework](#the-framework): an assembly signed with one of Microsoft's keys that the target framework of the Assembly making the reference provides | Nothing: it is left to the target framework | `framework` |
| 2 | A [NuGet package](#nuget-packages) that holds the very assembly | A `PackageReference` | `nuget-package` |
| 3 | A [Sibling Assembly](#sibling-assemblies): the application's own Assembly beside the input | A project of its own, and a `ProjectReference` | `sibling-assembly` |
| 4 | Any other Assembly beside the input: a [copied binary](#copied-binaries) | `Dependencies/<file>`, and a `Reference` with a `HintPath` | `copied-binary` |
| 5 | Nothing: an [Unresolved Dependency](#unresolved-dependencies) | Nothing; the Reconstruction is Partial | `unresolved` |

## The framework

A reference is the framework's (FR-10.1) when its assembly is signed with one of the keys Microsoft signs .NET's own assemblies with, and the target framework of the Assembly making it provides it: the framework's reference assemblies, which the .NET SDK builds the project against, hold an assembly of that name (ignoring case), at that version or later. Nothing is written for it, and it is not looked up as a NuGet package. Microsoft signs many of its NuGet packages with the same keys (`System.CommandLine`, `NuGet.Versioning`, `System.CodeDom`, `Microsoft.Extensions.*`, or `System.Text.Json` for .NET Framework), so the key alone does not tell them from the framework's; the list the reference assemblies' own package gives does:

| Target framework | Its reference assemblies, as listed by |
|---|---|
| .NET 5 and later, .NET Core 3.x (`net8.0`) | `Microsoft.NETCore.App.Ref`, of the same major and minor version (8.0.x), in `data/FrameworkList.xml`; for an Assembly using Windows Forms or WPF, `Microsoft.WindowsDesktop.App.Ref`'s too |
| .NET Framework (`net48`, `net40-client`) | `Microsoft.NETFramework.ReferenceAssemblies.net48` 1.0.3, the package the project references, in `build/.NETFramework/v4.8/RedistList/FrameworkList.xml` (its Client Profile's for `net40-client`) |
| .NET Standard 2.1 | `NETStandard.Library.Ref` 2.1.0, in `data/FrameworkList.xml` |
| .NET Standard 2.0 | `NETStandard.Library` 2.0.3: the assemblies in `build/netstandard2.0/ref`, which it lists nowhere, so only the one of the name asked about is read, for its version |

- **Where it looks.** First in the packs folder of the .NET SDK that builds the Recovered Solution (`packs/`, beside the `sdk/` folder `dotnet --list-sdks` names), as that SDK builds against the packs it has; then in the global-packages folder; then on nuget.org, never with `--offline`, which is sent the package's id and version only, [as for any package](#nuget-packages). Each is found and read once in a Reconstruction, however many references need it.
- **Whose target framework.** Each reference is resolved once by name, for the first Assembly making it: the input's references first, then each Sibling Assembly's. Its target framework is the one asked of.
- **One it does not provide** is one of Microsoft's packages, and Dependency Resolution goes on to the [NuGet step](#nuget-packages), which finds it by name, version and public key token, as any other. Should no package hold it, a copy beside the input is a [copied binary](#copied-binaries): being Microsoft's, it is never reconstructed as a Sibling Assembly, even when the input is strong-named with the same key. For [minver-cli 8.0.0](https://www.nuget.org/packages/minver-cli/8.0.0)'s `minver.dll`, which references `System.Runtime`, which .NET 8 provides, and `NuGet.Versioning`, which it does not, `dependencies` in `xray-report.json` says:

  ```text
  System.Runtime 8.0.0.0 is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), and net8.0, the target framework of minver, provides it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Runtime 8.0.0.0. It is left to the target framework.
  NuGet.Versioning 7.3.0.0 is signed with one of Microsoft's keys (public key token 31bf3856ad364e35), but net8.0, the target framework of minver, does not provide it: Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds no assembly named NuGet.Versioning. So it is one of Microsoft's packages, looked up as any other, though never reconstructed as a Sibling Assembly. NuGet.Versioning 7.3.0, on nuget.org, holds NuGet.Versioning 7.3.0.0, public key token 31bf3856ad364e35 as lib/net8.0/NuGet.Versioning.dll, the very file beside the input (/home/me/minver/NuGet.Versioning.dll). /home/me/minver/minver.deps.json says the application's NuGet.Versioning is from NuGet.Versioning 7.3.0.
  ```

  The `microsoft-packages` Fixture uses three such packages: System.CommandLine 2.0.5 and NuGet.Versioning 7.3.0, which .NET 8 does not hold at all, and System.Collections.Immutable 9.0.0, whose assembly, `9.0.0.0`, is newer than the `8.0.0.0` .NET 8 holds (`… holds System.Collections.Immutable only at 8.0.0.0, older than 9.0.0.0`). Each is a `PackageReference`, and it is a Full Reconstruction.
- **Where it cannot tell,** as when the reference assemblies are nowhere to be found (offline, with neither the .NET SDK nor the global-packages folder holding them), or Xray knows none for the target framework (.NET Core before 3.0, .NET Standard before 2.0, or one that could not be told), the reference is left to the target framework, as one of Microsoft's assemblies, and its reason says why Xray could not tell: `… so it is taken to be the framework's, and left to the target framework, as Xray could not tell whether net6.0, the target framework of App, provides it: Microsoft.NETCore.App.Ref 6.0.x, the reference assemblies of .NET 6.0, is in neither the .NET SDK's packs folder nor the global-packages cache, and nuget.org was not asked (--offline).`

## NuGet packages

An assembly held by a NuGet package is referenced as that package (FR-10.2): its project gets a `PackageReference`, rather than the assembly being reconstructed as a Sibling Assembly, even when `dotnet build` copied it beside the Assembly, as it does for a .NET Core or .NET 5+ program. For the `nuget-dependencies` Fixture, a program that uses Newtonsoft.Json 13.0.3 and Serilog 3.1.1:

```xml
<ItemGroup>
  <!-- NuGet packages, each holding an assembly the original references. -->
  <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  <PackageReference Include="Serilog" Version="3.1.1" />
</ItemGroup>
```

- **What matches.** A reference is matched by the assembly's name, version and public key token (and culture): a `lib/` folder of the version chosen must hold an assembly of that very identity. The package is one the app's `.deps.json` says the assembly came from (below), else the one named after the assembly, as packages and their assemblies usually are. The version of the assembly is not the package's: Serilog 3.1.1 holds `Serilog 2.0.0.0`, and every Newtonsoft.Json 13.0.x holds `Newtonsoft.Json 13.0.0.0`.
- **The app's `.deps.json`.** `dotnet build` writes one beside a .NET Core or .NET 5+ program, named after it (`Watchman.deps.json` for `Watchman.dll`), saying which version of which package each of its assemblies came from. If the input has one, the packages it says hold an assembly of the reference's name are tried first, and the versions it names first of those, before the package of the assembly's name. So a package named otherwise than its assembly is found (`CommandLine.dll` is in `CommandLineParser`), and so is the very release of one whose assembly version hundreds of releases share (every AWS SDK for .NET 3.x assembly is `3.3.0.0`). What it says is a hint, never taken on trust: what the package holds is still matched against the reference as above. One that is not JSON is ignored, and the packages are looked for as if there were none. A .NET Framework program has none.
- **What it leaves alone.** A reference the target framework provides is the framework's, and is never looked up; see [The framework](#the-framework). One to one of Microsoft's packages that it does not provide is looked up as any other.
- **Where it looks.** First in NuGet's global-packages folder, the cache `dotnet restore` fills: `NUGET_PACKAGES` if set, else `~/.nuget/packages`. Only if no package there holds the assembly is nuget.org asked, and never with `--offline`. Every version in the cache is weighed. On nuget.org, versions are downloaded one by one, the likeliest first, until one holds it: the one the `.deps.json` names, and the one the copy of the assembly beside the input names (its `AssemblyInformationalVersion`, such as `13.0.3+0a2e291c`), then the newest stable version down. It stops early once a version holds an older assembly than the one referenced, or no assembly of that name, and after at most 10 downloads for one reference, of whichever packages.
- **Which, of several.** Patch releases often hold the same assembly, so several versions may match. Of those, the one whose assembly is, byte for byte, the copy beside the input is chosen; failing that, the highest version, stable before prerelease: the likeliest to be what the application was built with, and the least likely to be older than another package it uses needs (which NuGet would refuse as a downgrade). The same packages always give the same choice, and `xray-report.json` (`packages`) says which versions matched and why one was chosen; the summary below repeats it.
- **An assembly that is not strong-named** could be in anyone's package of its name, so Xray takes a package for it only if it holds the very file beside the input. With no copy of it beside the input, it is not looked up at all.
- **What is sent.** Only package identifiers and versions go over the network, as the URLs of nuget.org's V3 API: its service index, `https://api.nuget.org/v3/index.json`; the versions of a package, `…/v3-flatcontainer/<id>/index.json`; and a version's package, `…/v3-flatcontainer/<id>/<version>/<id>.<version>.nupkg`, each a `GET` with no body. The `<id>` asked for is the name of an assembly the input references, or a package its `.deps.json` names, or that of the package holding [the framework's reference assemblies](#the-framework), so that name is sent, whether a package of it turns out to exist or not; no file, path or anything else about the input is. Downloaded packages are read in a temporary folder, deleted once dependencies are resolved. Building the Recovered Solution then restores the packages chosen, as `dotnet restore` does.
- **When none holds it,** or nuget.org cannot be reached, the reference falls through to the next step: an Assembly of its name beside the input, a [Sibling Assembly](#sibling-assemblies) or a [copied binary](#copied-binaries); else it is an [Unresolved Dependency](#unresolved-dependencies). `packages` in `xray-report.json` still records the lookup, and why it found nothing.
- **`--offline`** makes no network calls at all. References are looked up only in the global-packages folder (and [the framework's reference assemblies](#the-framework) in the .NET SDK's packs folder and the global-packages folder), and `dotnet build` restores only from it (`-p:RestoreSources=<that folder>`, with NuGet's audit, which asks the feed about vulnerabilities, turned off), so a package not already there fails to restore. A reference only nuget.org could resolve is left to the next step, as above.

## Sibling Assemblies

A Sibling Assembly is an application's own Assembly, found beside the one being reconstructed (FR-10.3). Each one the Assembly references, and each one those reference in turn, is decompiled as the Assembly is, and becomes a project of its own in the same solution, which the projects of the Assemblies that reference it reference with a `ProjectReference` (FR-11). For the `multi-assembly` Fixture, a program that references two class libraries, `Inventory` and `Pricing`, of which `Pricing` references `Inventory` too:

```text
<dir>/
  MultiAssembly.sln            holds all three projects
  MultiAssembly/
    MultiAssembly.csproj       references ..\Inventory\Inventory.csproj and ..\Pricing\Pricing.csproj
    …
  Inventory/
    Inventory.csproj
    …
  Pricing/
    Pricing.csproj             references ..\Inventory\Inventory.csproj
    …
  xray-report.json
```

```xml
<ItemGroup>
  <!-- Sibling Assemblies, each recovered as a project of its own. -->
  <ProjectReference Include="..\Inventory\Inventory.csproj" />
  <ProjectReference Include="..\Pricing\Pricing.csproj" />
</ItemGroup>
```

- **Where it looks.** For a reference to the assembly `Name`, Xray looks only where the runtime would: for `Name.dll` and `Name.exe` in the Assembly's own folder, ignoring case, as .NET does. A file there that is not a Managed Assembly, or whose assembly is named otherwise, is not it. An Assembly beside it that nothing references is not reconstructed, nor is anything in a subfolder.
- **What comes first.** A reference a [NuGet package](#nuget-packages) holds is referenced as that package, and is not a Sibling Assembly, even when the assembly is beside the input.
- **Whose it is.** Only the application's own Assembly is a Sibling Assembly: one that is not strong-named, or is strong-named with the input Assembly's own key (the same public key token). One strong-named with another key is a third party's, and is a [copied binary](#copied-binaries) instead, never reconstructed.
- **What it leaves alone.** A reference to an assembly signed with one of the keys Microsoft signs .NET and its own packages with (`System.Runtime`, `mscorlib`, `netstandard`, `PresentationFramework`, `Microsoft.Extensions.*`…) is never a Sibling Assembly, even when the assembly is beside it, as in a self-contained application: it is the framework's, left to the target framework (`resolution` `framework`), where the target framework provides it, or else one of Microsoft's packages, referenced as a package or, failing that, copied; see [The framework](#the-framework).
- **Each project** is laid out as the Assembly's is (below), named after its own Assembly, with its own target framework, output type, root namespace, unsafe code, nullable context and assembly attributes, `InternalsVisibleTo` among them. Two names that would make the same folder (ignoring case) get `-2`, `-3`… The solution holds the Assembly's project first, then each Sibling Assembly's, in the order they were found: the Assembly's references, by name, then theirs.
- **Two Assemblies of one name.** Should both `Name.dll` and `Name.exe` be Managed Assemblies named `Name`, the `.dll` is reconstructed (or copied), as the runtime would load it, and the duplicate is reported (`siblingProblems` in `xray-report.json`, and in the summary below). The Reconstruction carries on.
- **A cycle.** Assemblies can reference one another in a cycle (a plugin built against the program that loads it, say); projects cannot, as MSBuild refuses a `ProjectReference` cycle. Xray reports the cycle and leaves out the reference that closes it, found walking the references from the Assembly, so every other project still builds; the one that made it does not, and the Reconstruction is Partial, with that project's errors at their files and lines. For the `cyclic-reference` Fixture: `CyclicReference references Plugin references CyclicReference, a cycle projects cannot have. The reference from Plugin to CyclicReference is left out, so Plugin does not build.`
- **`--no-siblings`** reconstructs only the Assembly: each Assembly beside it that one of its references names, and no NuGet package holds, is a [copied binary](#copied-binaries) instead, referenced as it is, so the Recovered Solution still builds. The resolve dependencies stage still runs, to look the Assembly's references up as NuGet packages.

## Copied binaries

An Assembly beside the input that a reference names, that no NuGet package holds, and that is not reconstructed as a Sibling Assembly, is copied into the Recovered Solution as it is (FR-10.4): into `<dir>/Dependencies/`, keeping its file name, and each project whose Assembly references it references it with a `HintPath`, so `dotnet build` compiles against it and copies it beside what it builds, as the original's build did. That is so for a third party's Assembly, strong-named with a key other than the input's (see [Sibling Assemblies](#sibling-assemblies)), and, with `--no-siblings`, for the application's own. For the `copied-binary` Fixture, a program that uses `Kestrelwood.Checksums`, a library no NuGet package holds, strong-named with its vendor's key:

```text
<dir>/
  CopiedBinary.sln
  CopiedBinary/
    CopiedBinary.csproj        references ..\Dependencies\Kestrelwood.Checksums.dll
    …
  Dependencies/
    Kestrelwood.Checksums.dll  byte for byte the one beside the input
  xray-report.json
```

```xml
<ItemGroup>
  <!-- Binaries found beside the original, copied into Dependencies and referenced as they are. -->
  <Reference Include="Kestrelwood.Checksums">
    <HintPath>..\Dependencies\Kestrelwood.Checksums.dll</HintPath>
  </Reference>
</ItemGroup>
```

- **Only what is referenced.** An Assembly beside the input that no reference names is not copied. Nor are a copied binary's own references looked through: an Assembly it needs that the solution's Assemblies do not reference is not copied with it.
- **Names.** Should a project's folder be named `Dependencies` too, the project's becomes `Dependencies-2`; two binaries whose file names differ only in case are kept apart as `Name.dll` and `Name-2.dll`.
- **In `xray ui`,** a copied binary is listed among the Recovered Solution's files, and is in its zip, but is not shown as text.

## Unresolved Dependencies

A reference that nothing satisfies (not the framework, no NuGet package, and no Managed Assembly of its name beside the input) is an Unresolved Dependency (FR-10.5). Nothing is written for it, and the Reconstruction is Partial: `reasons` in `xray-report.json` gives `unresolved-dependencies` first, naming each, whether the Recovered Solution was built or not, and the summary says why nothing satisfies it (below). Its build then fails where the code uses it, with those errors at their files and lines too. For the `missing-reference` Fixture, whose class library, `Greetings`, is not beside it:

```text
Partial, because nothing satisfies this reference, an Unresolved Dependency:
  Greetings 1.0.0.0, referenced by MissingReference. Greetings is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of Greetings 1.0.0.0, not strong-named beside it, so no package was looked for. No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.
```

To resolve one, put the Assembly it names beside the input, or in the global-packages cache the package that holds it, and reconstruct again.

## PDBs

A PDB beside an Assembly, named after it (`App.pdb` beside `App.dll` or `App.exe`), is used to decompile that Assembly if it is the Assembly's own (FR-4): a portable PDB, as the .NET SDK writes by default on every OS, or a Windows PDB, the older format Windows writes for `DebugType` `full` or `pdbonly`. Each Sibling Assembly is decompiled with its own PDB alike. A PDB is the Assembly's own when its ID is the one the Assembly's CodeView debug directory entry records, which every build changes. A PDB is only read, never loaded or run, and one embedded in the Assembly, on a symbol server or at the path the Assembly records is not looked for. [`xray inspect`](xray-inspect-json.md) says which PDB is beside an Assembly, and whether it is its own.

Decompiled with its own PDB:

- **Locals keep the names they were given.** For the `debug-symbols` Fixture, `for (int position = 0; …)`, `string operation = args[position];` and `decimal missing = amount - Balance;`, where without it the decompiler names them itself: `for (int i = 0; …)`, `string text = args[i];`, `decimal num = amount - Balance;`. Parameters, fields and properties keep theirs anyway, as the Assembly's metadata records them.
- **Files are laid out as the original's source files were**, rather than by namespace: each file the PDB records is at its path below the folder that holds them all, most likely the original's project folder, which a PDB does not record, declaring every type that was declared in it, in their order in the Assembly. A partial type, whose parts the PDB records in each of their files, is declared once, in the file most of its own methods were declared in. Still laid out by namespace, as without a PDB: a type a Windows PDB records no file for, having no code of its own (an interface, an enum), as a portable one does; a type the compiler made up; a file that is not C# (`.cshtml`); and one outside that folder, while files the build generated, below a folder named `obj`, do not decide which folder that is.

For the `debug-symbols` Fixture, whose source is laid out unlike its namespaces:

```text
<dir>/DebugSymbols/
  DebugSymbols.csproj
  Properties/AssemblyInfo.cs
  Program.cs                                     Ledger.Program
  Accounts/Account.cs                            Ledger.Banking: Account, Transaction and TransactionKind
  Accounts/IAccountSource.cs                     Ledger.Banking.IAccountSource
  Accounts/Errors/InsufficientFundsException.cs  Ledger.Banking.InsufficientFundsException
  Reports/Formatting.cs                          Ledger.Reports.Formatter and its file-scoped Widths; Ledger.Reports.Columns: Alignment and Column
  Reports/Statement.cs                           Ledger.Reports.Statement, with what Statement.Totals.cs declared of it
```

Without its PDB, it is laid out by namespace below its root namespace, `Ledger`: `Banking/Account.cs`, `Banking/Transaction.cs`, `Banking/TransactionKind.cs`, `Reports/Columns/Column.cs`…

A PDB beside the Assembly that is not its own (another build's, or one for an Assembly built without debug information, which records none) or that cannot be read as one is ignored, with a warning on stderr, and the Assembly is decompiled as if there were none. The Reconstruction is no less Full for it:

```text
Warning: Ignored the PDB beside Arithmetic.dll, /home/me/app/Arithmetic.pdb. Arithmetic.pdb, a portable PDB, is not Arithmetic.dll's own: its ID is not the one Arithmetic.dll records, so it is another build's. So Arithmetic's local variables are named, and its source files laid out, as without a PDB.
```

The report gives the same warning in `warnings`, and says, for each project, which PDB was found beside its Assembly and whether it was used, in `solution.projects[].pdb` ([schema](xray-report-json.md)).

## Obfuscation

As it reads each Assembly, the input and each Sibling Assembly, Xray looks for the signs an obfuscator leaves (FR-3), and says whether it is likely obfuscated, and by which signs: [`xray inspect`](xray-inspect-json.md) gives them as `obfuscation`. An obfuscated Assembly is reconstructed all the same, and as it is: nothing is renamed back, no string is decoded, and no protection is removed (ADR 0002). Its project has the names and strings the obfuscator left, so its C# may well not build, as when an obfuscator gives two fields of one type the same name, which C# cannot declare. Only the Assembly's metadata and IL are read, never run. The signs, each an `indicators` entry:

- **`obfuscator-attribute`**: an attribute applied to the assembly or its module that a known obfuscator marks its output with: ConfuserEx's `ConfusedByAttribute`, Dotfuscator's `DotfuscatorAttribute`, SmartAssembly's `SmartAssembly.Attributes.PoweredByAttribute`, Crypto Obfuscator's, Agile.NET's and CliSecure's, Goliath.NET's, Babel's, Yano's or Xenocode's. Not `System.Reflection.ObfuscationAttribute` or `ObfuscateAssemblyAttribute`, which ask an obfuscator to obfuscate, and which it removes once it has.
- **`mangled-identifiers`**: the names of its types, methods, fields, properties and events are an obfuscator's, not a programmer's: any of them holds a character no source file shows (a control, format, private-use, unassigned or surrogate code point, or a separator other than the space, as ConfuserEx names things), or at least half of them, of 10 or more, are one or two characters long (as Obfuscar and Dotfuscator rename them: `A`, `a`, `B`…). Names the compiler makes up (holding `<`, as a lambda's or a backing field's do), constructors, accessors and explicit interface implementations, named after something else, are not counted. Ordinary code names few things so briefly: at most 6% of the names of any assembly of the .NET 8 shared framework, or of any Fixture.
- **`encrypted-strings`**: its strings are hidden: as many of them, or more, are fetched by calls to string decoders, from outside the type holding them, as are written as literals (`ldstr`). A string decoder is a static method that returns a `string` and takes nothing but integers, of a type one of whose methods decodes bytes into text (`System.Text.Encoding.GetString`), as Obfuscar, ConfuserEx and SmartAssembly hide strings; a property's accessor is not one.

An obfuscated Assembly gets a warning on stderr, and in the report's `warnings`. The Reconstruction is no more Partial for it, though its build may well fail. For the `obfuscated` Fixture, which Obfuscar renames, and whose strings it hides, as it is built:

```text
Warning: Obfuscated.dll is likely obfuscated. 79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer. Its strings are hidden: 23 calls fetch them from string decoders, which decode them from bytes (in <PrivateImplementationDetails>{B9661AAF-D5F4-4AD6-9C6B-533D1B6AC7FE}.4C778FB7-5732-4E85-86A3-7EEF367292B7), against 0 literals. It was reconstructed as it is, not deobfuscated: Obfuscated's names and strings are the obfuscator's.
```

Its Recovered Solution holds `Obfuscated/A/A.cs`, `Obfuscated/A/a-2.cs`… and the type Obfuscar hid its strings in, and does not build: `error CS0102: The type 'B' already contains a definition for 'm_A'`. The report says, for each project, whether its Assembly is obfuscated, in `solution.projects[].obfuscation`, and whether the input Assembly is, in `obfuscated` ([schema](xray-report-json.md)).

## Resources

Every resource of an Assembly's manifest is recovered into its project, and so is every resource of its satellite assemblies, each under the logical name the original's manifest gives it, public or private as it was (FR-12): the rebuilt Assembly's manifest, and each rebuilt satellite assembly's, name the same resources. Each Sibling Assembly's are recovered alike. The engine reads them from the Assembly's metadata, never loading or running any of it, and [`xray inspect`](xray-inspect-json.md) counts them as `resourceCount`.

- **A satellite assembly** is `<culture>/<Name>.resources.dll` beside the Assembly (`fr/Phrasebook.resources.dll`), ignoring case: a Managed Assembly named `<Name>.resources`, of the culture its folder is named after, as the runtime loads one. A file there that is not one is no satellite assembly, and is left out. The build makes each again, from the resources of its culture, with the Assembly's version, as the runtime needs.
- **A `.resources` file becomes a `.resx`** (`Strings.resx`), which the build compiles back to it, if every one of its entries is a string, a `byte[]` or a stream: those a `.resx` built by the .NET SDK holds without `System.Resources.Extensions`. A string is written in the `.resx`, every character kept: a `\r` as `&#xD;`, which XML would otherwise read as a `\n`. A `byte[]` or a stream is written to a file of its own, in a folder named after the `.resx` (`Images/Flag.png` beside `Images.resx`), named after its entry and given an image's own extension (`.png`, `.jpg`, `.gif`, `.bmp`, `.ico`), `.txt` for text, or `.bin`, and the `.resx` refers to it, as Visual Studio does (`ResXFileRef`). The comments of a `.resx` are not compiled into an Assembly, so none is recovered.
- **Anything else is embedded as it is**, byte for byte: a file (`logo.png`, `motd`), and a `.resources` file that holds anything else, such as an `int`, a `bool` or an object serialized with `BinaryFormatter` (a WinForms `Bitmap`), or a string XML cannot hold (`U+0001`), which a `.resx` built by the .NET SDK cannot hold again. That `.resources` file gets a warning on stderr, and in `warnings` in `xray-report.json` (`resource-kept-as-is`); the Reconstruction is no less Full for it.
- **A linked resource**, kept in another file or assembly (`csc /linkresource`) rather than embedded, is not recovered, with a warning (`resource-not-recovered`): the rebuilt Assembly has no resource of that name.

Each is laid out beside the sources: a resource named after a type, as Visual Studio names a form's or a resource class's (`Phrasebook.Phrases.Menu.resources`), beside that type's file, named after it (`Phrases/Menu.resx` beside `Phrases/Menu.cs`, where its PDB put it); any other in the folder of the longest namespace of the project's its name starts with, named by the rest of it (`Phrasebook.Assets.flag.png` → `Assets.flag.png`, as `Phrasebook.Assets` has no types), as ILSpy lays them out, since a name does not say which of its dots were folders; and one in no namespace of the project's at the top (`motd`). A satellite assembly's resource is beside the Assembly's own of the same name, its culture before its extension (`Strings.fr.resx`, `Assets.notes.fr.txt`), which is how the build tells which satellite assembly a file goes to. A neutral resource's file whose name the build would take for a culture's has that dot made a `_` (`jquery.min.js` → `jquery_min.js`, `min` being a language's code). Names are made safe, and kept apart, as source files' are (see [The Recovered Solution](#the-recovered-solution)).

The project lists every resource, so the .NET SDK embeds none of its own making:

```xml
<PropertyGroup>
  …
  <!-- Each resource is listed below, under the name the original gives it. -->
  <EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems>
</PropertyGroup>

<ItemGroup>
  <!-- The original's resources: each .resx compiles back to the .resources file it was; any other file is embedded as it is. -->
  <EmbeddedResource Include="Strings.resx" LogicalName="Phrasebook.Strings.resources" />
  <EmbeddedResource Include="Phrasebook.Secret" LogicalName="Phrasebook.Secret" Access="Private" />
  <EmbeddedResource Include="Strings.fr.resx" LogicalName="Phrasebook.Strings.fr.resources" />
  …
</ItemGroup>
```

A file embedded as it is that the SDK would otherwise compile, a `.cs`, gets a `<Compile Remove>`, and one whose name ends `.resx`, `Type="Non-Resx"`.

For the `resources` Fixture, whose Assembly, `Phrasebook`, has French and German satellite assemblies:

```text
<dir>/Phrasebook/
  Phrasebook.csproj
  Program.cs, Png.cs, Text.cs, Phrases/Menu.cs
  Strings.resx                 Phrasebook.Strings.resources
  Strings.de.resx              Phrasebook.Strings.de.resources, of de/Phrasebook.resources.dll
  Strings.fr.resx              Phrasebook.Strings.fr.resources, of fr/Phrasebook.resources.dll
  Phrases/Menu.resx            Phrasebook.Phrases.Menu.resources, beside the type it is named after
  Phrases/Menu.fr.resx         Phrasebook.Phrases.Menu.fr.resources, of fr/
  Images.resx                  Phrasebook.Images.resources: a string, a byte[] and a stream…
  Images/Flag.png              …the byte[]…
  Images/Anthem.txt            …and the stream, which it refers to
  Assets.flag.png              Phrasebook.Assets.flag.png, as it is
  Assets.notes.fr.txt          Phrasebook.Assets.notes.txt, of fr/, as it is
  motd                         motd, as it is
  Phrasebook.Secret            Phrasebook.Secret, private, as it is
  Limits.resources             Phrasebook.Limits.resources, as it is, as it holds an int
```

with the warning:

```text
Warning: Phrasebook.Limits.resources, a resource of Phrasebook.dll, is embedded as it is, as Phrasebook/Limits.resources, rather than written as a .resx. Its entry "MaxPhrases" is a System.Int32, not a string, a byte[] or a stream. A .resx the .NET SDK builds holds only strings, and byte[]s and streams in files it refers to, without System.Resources.Extensions; the rebuilt Assembly holds this resource byte for byte all the same.
```

The `resources` Fixture passes the Round-trip on every OS, with and without its PDB: each resource, and each satellite assembly's, reads back the same at runtime. The report says what became of each resource of each project, in `solution.projects[].resources` ([schema](xray-report-json.md)). A WPF Assembly's resources, `<Name>.g.resources`, are split back into the XAML files their BAML was compiled from, and the files they held, instead: see [WPF](#wpf).

## Windows Forms

An Assembly that references `System.Windows.Forms`, a Windows Forms app or a library of controls, is reconstructed into a project that uses Windows Forms again (FR-12), and builds on Windows, macOS and Linux alike, though what it builds runs only on Windows (ADR 0004). `xray inspect` calls a Windows GUI program referencing it `winforms` (`outputKind`).

- **Its project** sets `<UseWindowsForms>true</UseWindowsForms>`. For .NET 5 and later, Windows Forms needs a Windows target framework: the original's is kept (`net8.0-windows7.0`), and one naming no platform gets `-windows` (`net8.0` → `net8.0-windows`). A project for a Windows target framework also sets `<EnableWindowsTargeting>true</EnableWindowsTargeting>`, without which the .NET SDK refuses to build it anywhere but on Windows. A .NET Framework or .NET Core 3.x one names no platform, and needs none.
- **Its forms** are decompiled as C#, each with the `InitializeComponent` its designer wrote, which builds the form, its controls, the components in its container and the event handlers they call, and reads its resources back with a `ComponentResourceManager`. Where the Assembly's own PDB is beside it, the form is in the file most of its methods were written in (`MainForm.cs`, rather than `MainForm.Designer.cs`), as any partial type is (see [PDBs](#pdbs)).
- **A form's resources**, its `.resources` file (`Greeter.MainForm.resources`), hold its icon and images as a `System.Drawing.Icon` and a `System.Drawing.Bitmap`, which no `.resx` the .NET SDK builds without `System.Resources.Extensions` can hold, so it is embedded as it is, byte for byte, beside the form's file (`MainForm.resources`), with a warning (`resource-kept-as-is`; see [Resources](#resources)). The .NET SDK writes such a file to be read by `System.Resources.Extensions`, as its header says: .NET's Windows Desktop framework holds it, but .NET Framework does not, so a project for .NET Framework embedding one references its package, version 8.0.0, which is copied beside what it builds, with a binding redirect in its `.exe.config` to it from the version the file names (as does a project for any other framework that does not hold it):

  ```xml
  <ItemGroup>
    <!-- Reads the resources embedded as they are that hold more than strings, byte[]s and streams. -->
    <PackageReference Include="System.Resources.Extensions" Version="8.0.0" />
  </ItemGroup>
  ```

- **`ApplicationConfiguration`**, which the Windows Forms source generator of .NET 6 and later writes into an app that calls `ApplicationConfiguration.Initialize()`, is decompiled with the rest of the Assembly; the project removes that generator, which would otherwise write it a second time:

  ```xml
  <!--
    ApplicationConfiguration is decompiled from the original, into which the
    Windows Forms source generator wrote it; keep the generator from writing it again.
  -->
  <Target Name="KeepDecompiledApplicationConfiguration" AfterTargets="ResolveTargetingPackAssets">
    <ItemGroup>
      <Analyzer Remove="@(Analyzer)" Condition="'%(Filename)' == 'System.Windows.Forms.Analyzers.CSharp'" />
    </ItemGroup>
  </Target>
  ```

- **Off Windows,** neither .NET Framework nor .NET's Windows Desktop framework is installed, so the engine is given the reference assemblies the .NET SDK builds the project against, to decompile it with: code using a type the decompiler cannot find is decompiled less precisely, and a form's `Dispose(bool)`, calling its base class's, would call itself. They are the targeting pack of the Assembly's framework: `Microsoft.WindowsDesktop.App.Ref`, its latest stable version for the framework's (`8.0.x` for `net8.0-windows7.0`), or .NET Framework's, `Microsoft.NETFramework.ReferenceAssemblies.net48` for `net48` (version 1.0.3, where it is there). Each is taken from the global-packages folder, where building a project for that framework has restored it, else from nuget.org, as a package's `.nupkg` (see [NuGet packages](#nuget-packages)), unless `--offline`. Found in neither, the Assembly is decompiled without it, with a warning on stderr, and in `warnings` in `xray-report.json` (`reference-assemblies-not-found`):

  ```text
  Warning: Greeter.dll was decompiled without the reference assemblies of Windows Forms for .NET 8.0, which Linux does not have: Microsoft.WindowsDesktop.App.Ref 8.0.x is not in the global-packages folder, and nuget.org was not asked, as Xray is offline. Code using them may be decompiled less precisely, so its project may not build or behave like the original: a call to a method of their base classes may call the override itself.
  ```

  On Windows, the decompiler finds the framework where Windows and the .NET SDK install it, and nothing more is looked for.

The `winforms` (.NET 8) and `net48-winforms` (.NET Framework 4.8) Fixtures are Full Reconstructions that pass the Round-trip, with and without their PDBs: they rebuild on every OS, the rebuilt Assembly holding every resource of the original's manifest byte for byte, and on Windows the rebuilt app stays alive once launched (see the [Fixtures](../../fixtures/README.md#gui-fixtures)). `--run` launches a Windows Forms app only on Windows (see [Run](#run)).

## WPF

An Assembly that references WPF (`PresentationFramework` or `PresentationCore`), a WPF app or a library of controls, or that holds BAML, is reconstructed into a project that uses WPF again (FR-12), and builds on Windows, macOS and Linux alike, though what it builds runs only on Windows (ADR 0004). `xray inspect` calls a Windows GUI program referencing it `wpf` (`outputKind`).

- **Its project** sets `<UseWPF>true</UseWPF>`, for a Windows target framework where .NET 5 or later needs one, with `<EnableWindowsTargeting>`, as for [Windows Forms](#windows-forms).
- **Its XAML is decompiled from its BAML.** The markup compiler compiles each XAML file of the original's project to BAML, in its WPF resources (`<Name>.g.resources`), each entry named after the file's path, lowercased (`controls/countbadge.baml`), beside every `Resource` file of the project (`assets/tally.png`). The engine decompiles each BAML entry back to XAML, with [ILSpy](https://github.com/icsharpcode/ILSpy)'s BAML decompiler: its elements, their properties and names (`x:Name`, `x:FieldModifier`), the events they hook, resource dictionaries, merged ones among them, and styles (implicit, keyed, `BasedOn` another, with `EventSetter`s, `Trigger`s and `DataTrigger`s), control and data templates, `StaticResource`s and `DynamicResource`s, bindings (by `ElementName` and `RelativeSource`, with a converter, a `StringFormat` or an `UpdateSourceTrigger`), objects of the app's own types (a `DataContext`, a converter), and an app's `StartupUri`. An app's own events (`Startup="App_Startup"`), which the markup compiler hooks in its `InitializeComponent` rather than in its BAML, are recovered from that. A core type BAML names, such as a `sys:Double`, is named in `mscorlib`, which every framework's reference assemblies have, not in the runtime's own library. Each XAML file is written where its entry says it was, in the case another file refers to it by, if one does (`Source="Themes/Palette.xaml"`, `Icon="Assets/tally.png"`, or a pack URI), and each `Resource` file likewise, byte for byte; a class's XAML file is beside its code-behind.
- **Its code-behind is reconciled with the markup compiler.** What the markup compiler generated of each class a XAML file names (`x:Class`), it generates again from that file as the project is built: so the class's decompiled C# is `partial`, and leaves out a field for each named element, `InitializeComponent`, `_contentLoaded`, the `Connect` methods of `IComponentConnector` and `IStyleConnector` through which its BAML hooks its fields and events (and those interfaces), `_CreateDelegate`, and an app's `Main`; it compiles beside them without a member declared twice. Each class is in a file named after its XAML file (`MainWindow.xaml.cs` beside `MainWindow.xaml`), as Visual Studio lays out a code-behind, in the case of its namespace's folders, or of its file where the Assembly's own PDB records it.
- **The app's `ApplicationDefinition`** is the XAML file of its `Application`, from which the markup compiler generated the Assembly's entry point, its `Main`; every other XAML file is a `Page`. The project lists each, and each `Resource`, so the .NET SDK adds none of its own making, and builds them back into WPF resources holding what the original's did:

  ```xml
  <PropertyGroup>
    …
    <UseWPF>true</UseWPF>
    …
    <!-- Each XAML file is listed below, as the original's project had it. -->
    <EnableDefaultPageItems>false</EnableDefaultPageItems>
    <EnableDefaultApplicationDefinition>false</EnableDefaultApplicationDefinition>
  </PropertyGroup>

  <ItemGroup>
    <!-- The original's XAML, decompiled from its BAML: the markup compiler compiles each file back, and generates the code its code-behind leaves out. -->
    <ApplicationDefinition Include="App.xaml" />
    <Page Include="Themes\Palette.xaml" />
    <Page Include="Controls\CountBadge.xaml" />
    <Page Include="MainWindow.xaml" />
  </ItemGroup>

  <ItemGroup>
    <!-- The files the original's WPF resources held beside its BAML, which the build puts back beside it. -->
    <Resource Include="Assets\tally.png" />
  </ItemGroup>
  ```

- **Off Windows,** WPF is installed no more than Windows Forms is, and BAML naming a type the decompiler cannot find is decompiled without the fields and events it hooks, so the engine is given the same reference assemblies, found the same way, with the same warning where they are found nowhere (`reference-assemblies-not-found`; see [Windows Forms](#windows-forms)).
- **BAML that cannot be decompiled**, should any document of it fail, is not decompiled at all: the WPF resources are recovered as any other `.resources` file is (see [Resources](#resources)), as the BAML they are, and every class keeps the code the markup compiler generated of it, which loads that BAML, so the project still builds, but has no XAML to change. It gets a warning on stderr, and in `warnings` in `xray-report.json` (`xaml-not-recovered`), as do WPF resources that cannot be split back into their files, though their BAML was decompiled. Localized BAML, in a satellite assembly's WPF resources (`<Name>.g.fr.resources`), is recovered as any other `.resources` file is.

For the `wpf` Fixture, whose Assembly is `Tally`:

```text
<dir>/Tally/
  Tally.csproj
  App.xaml                     app.baml, the ApplicationDefinition: StartupUri, Startup, a merged dictionary and an implicit style
  App.xaml.cs                  its code-behind
  MainWindow.xaml              mainwindow.baml, a Page
  MainWindow.xaml.cs           its code-behind
  Controls/CountBadge.xaml     controls/countbadge.baml, a Page
  Controls/CountBadge.xaml.cs  its code-behind
  Themes/Palette.xaml          themes/palette.baml, a Page: a resource dictionary of its own
  Assets/tally.png             assets/tally.png, a Resource
```

The `wpf` (.NET 8) and `net48-wpf` (.NET Framework 4.8) Fixtures are Full Reconstructions that pass the Round-trip, with and without their PDBs: they rebuild on every OS, the rebuilt Assembly's BAML decompiling to the same XAML as the original's and its `Resource` files byte for byte, and on Windows the rebuilt app stays alive once launched (see the [Fixtures](../../fixtures/README.md#gui-fixtures)). The report says what became of the WPF resources in `solution.projects[].resources`, as `xaml` ([schema](xray-report-json.md)). `--run` launches a WPF app only on Windows (see [Run](#run)).

## The Recovered Solution

`<Name>` is the Assembly's name; each Sibling Assembly's project is beside its own (see [Sibling Assemblies](#sibling-assemblies)), as is `Dependencies/`, if anything was copied (see [Copied binaries](#copied-binaries)). Its resources are beside its sources (see [Resources](#resources)). For the arithmetic Fixture:

```text
<dir>/
  Arithmetic.sln
  Arithmetic/
    Arithmetic.csproj
    Properties/AssemblyInfo.cs
    Program.cs                 namespace Arithmetic: the root namespace
  xray-report.json             how the Reconstruction went
```

- **`<Name>.sln`** holds the project, and each Sibling Assembly's, in `Debug` and `Release`. A project's GUID depends only on its Assembly's name, so reconstructing the same Assembly again writes the same file.
- **`<Name>/<Name>.csproj`** is SDK-style, whatever the target framework (ADR 0004). It recovers what the original's project said that its Assembly records (FR-9), so what it builds has the same name, version and attributes:

  | Property | Value |
  |---|---|
  | `<AssemblyName>` | The Assembly's name, `<Name>`. |
  | `<RootNamespace>` | Not recorded in an Assembly, so told from its types' namespaces: `<Name>`, the default, if every type is in that namespace or below it; otherwise the longest namespace every type is in or below; otherwise `<Name>` again. Types in the global namespace do not count. |
  | `<OutputType>` | `Exe` for a console program, `WinExe` for a Windows GUI one, `Library` for a library. |
  | `<TargetFramework>` | The original's, exactly (`targetFramework.moniker` in [`xray inspect --json`](xray-inspect-json.md)): see below; with `-windows` where Windows Forms or WPF needs it (see [Windows Forms](#windows-forms)). |
  | `<UseWindowsForms>` | `true` if the original references `System.Windows.Forms`; otherwise absent (see [Windows Forms](#windows-forms)). |
  | `<UseWPF>` | `true` if the original references `PresentationFramework` or `PresentationCore`, or holds BAML; otherwise absent (see [WPF](#wpf)). |
  | `<EnableWindowsTargeting>` | `true` for a Windows target framework (`net8.0-windows7.0`), so it builds on any OS; otherwise absent. |
  | `<LangVersion>` | `12.0`, the newest C# the .NET SDK 8 can compile, which the code is decompiled to. Always given, as no target framework's default is newer and .NET Framework's is C# 7.3; decompiled code can use C# 12 (primary constructors), C# 11 (`file` types, list patterns) and C# 9 (records, `init`) whatever the original was written in. |
  | `<AllowUnsafeBlocks>` | `true` if the original was compiled with unsafe code allowed, as the `[module: UnverifiableCode]` the compiler then adds records; otherwise absent. |
  | `<Nullable>` | `annotations` if any of the original was compiled with nullable annotations, as the `NullableAttribute`s and `NullableContextAttribute`s the compiler applies record; otherwise absent. Not `enable`: an Assembly does not record whether its build also warned, and decompiled code draws nullable warnings its source did not. |
  | `<GenerateAssemblyInfo>` | `false`: `Properties/AssemblyInfo.cs` declares the original's assembly attributes, so the SDK generates none of its own. |

  | The original's `TargetFrameworkAttribute` | `<TargetFramework>` |
  |---|---|
  | `.NETFramework,Version=v4.0` … `v4.8.1` | `net40`, `net45`, `net451`, `net452`, `net46`, `net461`, `net462`, `net47`, `net471`, `net472`, `net48`, `net481` |
  | `.NETFramework,Version=v4.0,Profile=Client` | `net40-client` |
  | `.NETCoreApp,Version=v3.1` | `netcoreapp3.1` |
  | `.NETCoreApp,Version=v8.0` (and any .NET 5+) | `net8.0`, with the platform if it has one: `net6.0-windows7.0` |

  A .NET Framework project also references the framework's reference assemblies from NuGet, so it builds on Windows, macOS and Linux alike, without the framework's targeting pack (FR-9). What it builds runs only on Windows:

  ```xml
  <ItemGroup>
    <!-- The framework's reference assemblies, so this builds on any OS. -->
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />
  </ItemGroup>
  ```

  A framework that is out of support, such as `netcoreapp3.1`, is kept all the same; the .NET SDK warns about it (`NETSDK1138`) as it builds, which does not count against the Reconstruction.
- **`Properties/AssemblyInfo.cs`** declares the original's assembly and module attributes (`AssemblyVersion`, `AssemblyFileVersion`, `AssemblyInformationalVersion`, `AssemblyTitle`, `AssemblyCompany`, `InternalsVisibleTo`…), leaving out those the compiler or SDK adds itself (`TargetFramework`, `CompilationRelaxations`, `RuntimeCompatibility`, `Debuggable`, `RefSafetyRules`, and the `UnverifiableCode` and `SecurityPermission(SkipVerification)` of unsafe code), so none is declared twice (`CS0579`).
- **The source files** are laid out as the original's were, where the Assembly's own PDB is beside it (see [PDBs](#pdbs)). Otherwise, and for each type that PDB records no file for, **one `.cs` file per top-level type**, named after it, in a folder per namespace below the root namespace, as Visual Studio lays out a project. For the arithmetic Fixture, whose root namespace is `Arithmetic`, without its PDB:

  | Type | File |
  |---|---|
  | `Arithmetic.Program` | `Arithmetic/Program.cs` |
  | `Arithmetic.Models.Point` | `Arithmetic/Models/Point.cs` |
  | ``Arithmetic.Models.Point`1`` (generic) | `Arithmetic/Models/Point-2.cs`: its name without the arity is taken |
  | `Vendor.Tools.Helper` (outside the root namespace) | `Arithmetic/Vendor/Tools/Helper.cs` |
  | `Helper` (the global namespace) | `Arithmetic/Helper.cs` |

  The `unsafe-nullable` Fixture's Assembly, `Xray.UnsafeNullable`, has its types in `Fixtures.Pointers` and `Fixtures.Pointers.Text`, so its root namespace is `Fixtures.Pointers` and `Fixtures.Pointers.Text.Directory` is in `Xray.UnsafeNullable/Text/Directory.cs`, as it is with its PDB, where `Entry` is declared beside it. The root namespace is told from every type's namespace, whichever file it is in.

  A type that uses file-scoped types is in a file named after the one they were declared in, as their names record, and declares them too: for the `newer-features` Fixture, `NewerFeatures.Files.Greetings` and the file-scoped `Format`, `IShout` and `Shouter` of `Greetings.cs` are in `NewerFeatures/Files/Greetings.cs`.

  A `[GeneratedRegex]` method is declared `partial`, as it was written, in a type declared `partial`, as is every type it is nested in, for the regex source generator to implement again as the Recovered Solution is built. What the generator wrote of it is left out, as the generator writes it again: the method's body, its `[GeneratedCode]`, and the `Regex` the body returns, which the generator declared file-scoped in `System.Text.RegularExpressions.Generated`, in `RegexGenerator.g.cs`, with a `Utilities` class. Declared with its body, the method is not `partial`, and the generator refuses it (`SYSLIB1043`). With the Assembly's own PDB, a type is in the file it was declared in, not the generator's, though the PDB records only the generator's code for its `[GeneratedRegex]` methods. For the `generated-regex` Fixture, `Lexicon.Text.Patterns`, which declares nothing but such methods, is in `Lexicon/Text/Patterns.cs`, or, with its PDB, in `Lexicon/Text/Expressions.cs`, where it was declared:

  ```csharp
  internal static partial class Patterns
  {
  	[GeneratedRegex("^[A-Za-z_][A-Za-z_0-9]*$")]
  	public static partial Regex Identifier();

  	[GeneratedRegex("-?\\d+", RegexOptions.CultureInvariant, 1000, "en-US")]
  	public static partial Regex Number();
  	…
  ```

  A file name another file already has, ignoring case as Windows and macOS do, gets `-2`, `-3`… before its `.cs` (no C# type name can contain `-`). Characters Windows does not allow become `_`, as does a trailing dot or space; a Windows device name (`CON`, `NUL`, `COM1`…), `bin`, `obj` or a name starting with `.` gets a leading `_`, so the SDK compiles everything.

## Target frameworks supported on a best-effort basis

FR-8 supports .NET Framework 2.0 and 3.5 and `netstandard` only as far as it can. An Assembly for one is reconstructed as any other is, its project for its own framework, but it is less certain to build and behave like the original. So `targetFramework.support` in [`xray inspect --json`](xray-inspect-json.md#fields) is `best-effort`, `xray inspect` adds `supported on a best-effort basis` to its target framework, and the Reconstruction warns of it on stderr, and in `warnings` in `xray-report.json` (`best-effort-target-framework`). For the `net35-library` Fixture, a .NET 8 program using `Gradebook`, a .NET Framework 3.5 library beside it:

```text
Warning: Gradebook.dll targets net35, which Xray supports only on a best-effort basis, not as fully as .NET Framework 4.x, .NET Core 3.1 or .NET 5 and later: Gradebook's project targets it as it is, but it is less certain to build and behave like the original. It records no TargetFrameworkAttribute, as nothing built before .NET Framework 4.0 does, so net35 was told from CLR v2.0.50727 and its reference to System.Core 3.5.0.0.
```

| The original | `<TargetFramework>` |
|---|---|
| No `TargetFrameworkAttribute`; CLR `v2.0.50727`, referencing an assembly of .NET Framework 3.0 or 3.5 (`System.Core 3.5.0.0`, `WindowsBase 3.0.0.0`…) | `net35` |
| No `TargetFrameworkAttribute`; CLR `v2.0.50727`, referencing none | `net20` |
| `.NETStandard,Version=v2.0` (and any .NET Standard) | `netstandard2.0` |
| Any other framework a project can target but FR-8 does not fully support, such as `.NETCoreApp,Version=v2.1` | `netcoreapp2.1` |

- **Before .NET Framework 4.0,** compilers wrote no `TargetFrameworkAttribute`, so the framework is told from the CLR the metadata was written for, and what the Assembly references. .NET Framework 2.0, 3.0 and 3.5 share CLR 2.0: an Assembly referencing one of the framework's assemblies (signed with one of .NET Framework's keys) at version 3.0 or 3.5 is `net35`; any other is `net20`, which builds the same code and runs on the same CLR. No reference assemblies of .NET Framework 3.0 alone are published, so an Assembly for it is `net35`, whose reference assemblies hold 3.0's. `inferredFrom` in `xray inspect --json`, and the warning, say how it was told. As for .NET Framework 4.x, the project references `Microsoft.NETFramework.ReferenceAssemblies`, so it builds on any OS (above).
- **.NET Framework 1.0 and 1.1** (CLR `v1.0.3705` and `v1.1.4322`) no SDK-style project can target, as no reference assemblies of them are published: an Assembly for one is refused as one whose target framework cannot be told (exit code 1), saying so, and nothing is written.
- **Index from the end** (`values[^1]`) needs `System.Index`, which .NET Framework and .NET Standard 2.0 have not, so it is not written for them (see [What it does](#what-it-does)).
- **A .NET 5+ project referencing a Sibling Assembly's project for .NET Framework,** as the `net35-library` Fixture's program does `Gradebook`'s, references it all the same. `dotnet build` warns that it may not be fully compatible (`NU1702`), which does not count against the Reconstruction; .NET 8 loads an Assembly built for .NET Framework 2.0 to 4.8 that uses only what .NET 8 has.
- **The `net35-library` and `netstandard20-library` Fixtures** pass the Round-trip on every OS, with and without their PDBs: each is a .NET 8 program and a library for the framework, both reconstructed. Each library reconstructed on its own is a Full Reconstruction, and what its project builds is told to be for the same framework as the original.

## Build diagnostics

`dotnet build` prints its errors and warnings in MSBuild's canonical format, `file(line,column): error CODE: message [project]`. Xray picks each one out once (the build prints them again in its summary) and maps it to the Recovered Solution:

| Field | |
|---|---|
| `severity` | `error` or `warning`. |
| `code` | The compiler's or tool's code, such as `CS0246`; empty if it gave none. |
| `message` | What it says, without the project the build appends. |
| `file` | The file it is about, relative to `<dir>` with `/` between segments, such as `MissingReference/Program.cs`. A file outside the Recovered Solution (an SDK targets file, say) keeps the absolute path the build printed. Absent when it names no file, as for a tool's own error (`MSBUILD : error MSB1009: …`). |
| `line`, `column` | 1-based, when it gives them. |
| `project` | The project being built, relative to `<dir>` as `file` is. |

## Run

`--run` runs the program the Recovered Solution builds to, once it has built (FR-14), and records what it did in `xray-report.json` as `run`. **That executes recovered code**, on this machine and with your permissions, so it never happens without `--run`, and `xray reconstruct` says so on stderr before it starts:

```text
Warning: --run executes recovered code. Once the Recovered Solution builds, its program runs on this machine, as you.
```

Use it only on Assemblies you trust. `--run` cannot be given with `--no-build`, which leaves nothing to run.

The program is the one `dotnet build` wrote to `<Name>/bin/Debug/<target framework>/`: `<Name>.dll`, started by the `dotnet` host, or, for .NET Framework, `<Name>.exe`, started as itself. It runs in that folder, with no arguments and nothing on stdin. If the runtime it targets is not installed it runs on a later one (`DOTNET_ROLL_FORWARD=Major`, unless you set `DOTNET_ROLL_FORWARD` yourself), as Xray needs only .NET 8 *or later*. Its exit code is recorded, and the first MiB of what it writes to stdout and to stderr.

| How it went (`run.status`) | When | Counts against the Reconstruction |
|---|---|---|
| **Exited** (`exited`) | It exited on its own, whatever its exit code. | No: whether the original would have exited with that code too is for a Round-trip to tell. |
| **Launched** (`launched`) | A Windows GUI program (WinForms, WPF, or any other `WinExe`) was still running 5 seconds after it started, so it launched; Xray then closed it. | No. |
| **Skipped** (`skipped`) | It cannot run here, for the reason given (below). | No. |
| **Crashed** (`crashed`) | It was ended by a signal, as .NET ends a program that throws an unhandled exception on Linux and macOS (`SIGABRT`), or exited with `0xE0434352`, as it does on Windows. | Yes: Partial. |
| **Timed out** (`timed-out`) | A console program was still running after 60 seconds, so Xray stopped it. | Yes: Partial. |
| **Failed to start** (`failed-to-start`) | It was not where `dotnet build` should have put it, or could not be started. | Yes: Partial. |

It is skipped, with why, where it cannot run:

| Program | Reason given |
|---|---|
| WinForms or WPF, anywhere but Windows | `It is a WinForms program, and WinForms runs only on Windows, not on Linux.` |
| .NET Framework (`net48`…), anywhere but Windows | `It targets net48, and a .NET Framework program runs only on Windows, not on macOS.` |
| A Windows target framework (`net8.0-windows`), anywhere but Windows | `It targets net8.0-windows, which runs only on Windows, not on Linux.` |
| A library | `It is a library, with no entry point, so there is no program to run.` |
| A Recovered Solution that did not build | `The Recovered Solution did not build, so there is no rebuilt program to run.` |

Comparing what it did with what the original does is a Round-trip's job, not `--run`'s.

## Outcome

| Outcome | When |
|---|---|
| **Full Reconstruction** | The Recovered Solution built, and, with `--run`, its program exited, launched, or was skipped as it cannot run here (above). Its warnings do not count against it, nor does its program's exit code. Whether it behaves like the original is what a Round-trip proves. |
| **Partial Reconstruction** | The Recovered Solution was written but has an [Unresolved Dependency](#unresolved-dependencies), built or not: the first reason given names each, and why nothing satisfies it. Or it did not build: the reason given is its build errors, each at its file and line. A build that fails without printing one (stopped for taking more than 10 minutes, say) is still Partial, and its output is shown instead. Or, with `--run`, it built but its program crashed, timed out or failed to start: the reason given is how, and `xray-report.json` has what it wrote. |
| **Unverified** | `--no-build` was given, so it was not built, and nothing is unresolved: neither Full nor Partial. |

## Progress

While it runs, `xray reconstruct` shows on stderr each stage of the Reconstruction (PRD §7.3, FR-19), numbered: analyse, decompile, resolve dependencies, generate solution, build, run the rebuilt program. They are the [progress events](progress-events.md) that `xray ui` streams to the browser. stdout holds only the summary, so `xray reconstruct … > summary.txt` keeps it apart.

On a terminal, each stage is a single line, rewritten in place several times a second while the stage runs: which type it is decompiling, of how many, which assembly it is looking up as a NuGet package or for beside the input, which Sibling Assembly it is reconstructing, of how many, or which file it is writing, and how long it has been running. When the stage ends, its line stays, saying how long it took, or why it was skipped:

```text
[2/6] Decompile: 120 of 2000 types (App.Models.Point), 4.2 s so far
[3/6] Resolve dependencies: 1 of 2 Sibling Assemblies (Pricing.dll), 1.3 s so far
```

Anywhere else, as in a CI log, each stage is a plain line as it starts and another as it ends, with a progress line only every 5 seconds between, so a long stage shows it is still running without flooding the log. For the arithmetic Fixture:

```text
[1/6] Analyse…
[1/6] Analyse: done in 89 ms
[2/6] Decompile…
[2/6] Decompile: done in 623 ms
[3/6] Resolve dependencies…
[3/6] Resolve dependencies: done in 6 ms
[4/6] Generate solution…
[4/6] Generate solution: done in 2 ms
[5/6] Build…
[5/6] Build: done in 1.0 s
[6/6] Run the rebuilt program: skipped. Running the rebuilt program executes recovered code, so it is run only when asked.
```

The resolve dependencies stage always runs, even with `--no-siblings`, as it looks references up as NuGet packages. With `--run`, the last stage runs: `[6/6] Run the rebuilt program…`, then `[6/6] Run the rebuilt program: done in 120 ms`; or it is skipped, saying why (see [Run](#run)). With `--no-build`, the build line is `[5/6] Build: skipped. Building was skipped, so the Recovered Solution is not verified.` A stage that fails ends `failed after 1.2 s`, and why follows. Input that is not a Managed Assembly gets no further than analyse.

## Output

On stdout, a concise summary of the `xray-report.json` it wrote: what was written, what became of its resources, which PDB it was decompiled with, whether it is obfuscated, how its references were resolved, the NuGet packages referenced, the project of each Sibling Assembly, the binaries copied, how it built, how long each stage took, the outcome, and where the report is, relative to the Recovered Solution:

```text
Recovered Solution  /home/me/out
Solution            Arithmetic.sln
Project             Arithmetic/Arithmetic.csproj
Target framework    net8.0
Output type         Exe
Types               1, each decompiled to a file of its own
Resources           none
PDB                 /home/me/xray/fixtures/.cache/arithmetic/bin/Arithmetic/release/Arithmetic.pdb, used for local names and source layout
Obfuscation         clean: no sign of it found
Dependencies        2 references: 2 framework
NuGet packages      none needed
Sibling Assemblies  none found beside it
Copied binaries     none
Build               succeeded
Time                1.7 s: analyse 86 ms, decompile 615 ms, resolve dependencies 6 ms, generate 2 ms, build 994 ms
Outcome             Full Reconstruction
Report              xray-report.json
```

`Project`, `Target framework`, `Output type` and `Types` are the Assembly's own project's. `Types` says how many top-level types were decompiled, then to how many files, where that is fewer, as when its PDB records several types in one file: `2, decompiled to 1 file`. `Resources` says how many resources the Assembly and its satellite assemblies have, then how many were written as `.resx`, embedded as they are, or not recovered, and the cultures of its satellite assemblies, if any: `11, each under its own name: 6 written as .resx, 5 embedded as they are; 2 satellite assemblies (de, fr)`, for the `resources` Fixture; or `none`. With Sibling Assemblies, it does so for each project, one to a line, unless none has any. `PDB` gives the PDB beside the Assembly, and whether it was `used for local names and source layout` or `ignored, as it is not the Assembly's own` (the warning on stderr says why); or says `none beside the Assembly`. With Sibling Assemblies, it does so for each project, one to a line. `Obfuscation` says whether the Assembly is `clean: no sign of it found`, or `likely obfuscated (mangled names, hidden strings): reconstructed as it is, not deobfuscated`, naming each sign found (`an obfuscator's attribute`, `mangled names`, `hidden strings`), for each project alike; the warning on stderr says what was found. `Dependencies` counts the references of every Assembly of the solution, then how many were resolved each way, in the order of [Dependency Resolution](#dependency-resolution): `7 references: 5 framework, 2 Sibling Assemblies`. `NuGet packages` lists each package referenced, by any project, with where it was found; or says `none needed` (every reference is the framework's) or `none found`, adding `(--offline: only the global-packages cache was looked in)` with `--offline`. For the `nuget-dependencies` Fixture:

```text
NuGet packages      2, each a PackageReference:
                    Newtonsoft.Json 13.0.3, from the global-packages cache
                    Serilog 3.1.1, from the global-packages cache
Sibling Assemblies  none found beside it
```

Where several versions of a package hold the assembly referenced, why one was chosen follows the summary, as `packages[].reason` in `xray-report.json` gives it:

```text
Chosen among several NuGet packages:
  2 versions of Newtonsoft.Json in the global-packages cache hold Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed: 13.0.3, 13.0.9. 13.0.3 is chosen, as its lib/net6.0/Newtonsoft.Json.dll is the very file beside the input (/home/me/app/Newtonsoft.Json.dll). /home/me/app/NuGetDependencies.deps.json says the application's Newtonsoft.Json is from Newtonsoft.Json 13.0.3.
```

`Sibling Assemblies` lists each Sibling Assembly's project, with how many types it has; or says there is none, or `not reconstructed (--no-siblings)`. For the `multi-assembly` Fixture, given its folder:

```text
Types               2, decompiled to 1 file
Resources           none
PDB                 MultiAssembly/MultiAssembly.csproj: /home/me/app/MultiAssembly.pdb, used for local names and source layout
                    Inventory/Inventory.csproj: /home/me/app/Inventory.pdb, used for local names and source layout
                    Pricing/Pricing.csproj: /home/me/app/Pricing.pdb, used for local names and source layout
Obfuscation         MultiAssembly/MultiAssembly.csproj: clean: no sign of it found
                    Inventory/Inventory.csproj: clean: no sign of it found
                    Pricing/Pricing.csproj: clean: no sign of it found
Dependencies        7 references: 5 framework, 2 Sibling Assemblies
NuGet packages      none found
Sibling Assemblies  2, each a project of its own:
                    Inventory/Inventory.csproj (8 types)
                    Pricing/Pricing.csproj (7 types)
Copied binaries     none
Build               succeeded
```

`Copied binaries` lists each binary copied into `Dependencies/`, with where it was found; or says `none`. For the `copied-binary` Fixture:

```text
Dependencies        3 references: 2 framework, 1 copied binary
NuGet packages      none found
Sibling Assemblies  none found beside it
Copied binaries     1, each referenced with a HintPath:
                    Dependencies/Kestrelwood.Checksums.dll, from /home/me/app/Kestrelwood.Checksums.dll
Build               succeeded
```

Anything worked around in the Sibling Assemblies, a duplicate name or a cycle, follows the summary, as `xray-report.json` gives it in `siblingProblems`. For the `cyclic-reference` Fixture:

```text
Worked around in the Sibling Assemblies:
  CyclicReference references Plugin references CyclicReference, a cycle projects cannot have. The reference from Plugin to CyclicReference is left out, so Plugin does not build.
```

`Build` counts the build's errors and warnings, if it had any: `succeeded with 2 warnings`, `failed with 1 error and 2 warnings`. The warnings themselves are in the report. `Time` gives the whole Reconstruction, then each stage (`timings` in the report): under a second in milliseconds, otherwise in seconds to a tenth.

With `--run`, a `Run` row follows `Build`, and `Time` ends with how long the program ran. For the arithmetic Fixture, which, given no arguments, prints its usage and exits 1:

```text
Build               succeeded
Run                 exited with code 1
Time                1.8 s: analyse 86 ms, decompile 615 ms, resolve dependencies 6 ms, generate 2 ms, build 994 ms, run 98 ms
Outcome             Full Reconstruction
```

`Run` is `exited with code N`, `launched, and was closed while still running`, or `skipped`, `crashed`, `timed out` or `failed to start`, followed by why: `skipped. It is a WinForms program, and WinForms runs only on Windows, not on Linux.` What the program wrote is in the report, as `run.stdout` and `run.stderr`. When it crashed, timed out or failed to start, the Reconstruction is Partial, and the summary ends `Partial, because the rebuilt program crashed. What it wrote is in xray-report.json, as run.stdout and run.stderr.`

A Partial Reconstruction then names each Unresolved Dependency, who references it, and why nothing satisfies it; then lists its build errors as `file:line:column: error CODE: message`, with `file` relative to the Recovered Solution. For the `missing-reference` Fixture, whose class library is missing:

```text
Recovered Solution  /home/me/out
Solution            MissingReference.sln
Project             MissingReference/MissingReference.csproj
Target framework    net8.0
Output type         Exe
Types               1, each decompiled to a file of its own
Resources           none
PDB                 /home/me/app/MissingReference.pdb, used for local names and source layout
Obfuscation         clean: no sign of it found
Dependencies        3 references: 2 framework, 1 unresolved
NuGet packages      none found
Sibling Assemblies  none found beside it
Copied binaries     none
Build               failed with 1 error
Time                1.5 s: analyse 88 ms, decompile 436 ms, resolve dependencies 6 ms, generate 2 ms, build 938 ms
Outcome             Partial Reconstruction
Report              xray-report.json

Partial, because nothing satisfies this reference, an Unresolved Dependency:
  Greetings 1.0.0.0, referenced by MissingReference. Greetings is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of Greetings 1.0.0.0, not strong-named beside it, so no package was looked for. No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.

Partial, because the Recovered Solution did not build:
  MissingReference/Program.cs:2:7: error CS0246: The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)
```

Only the first 10 errors are listed, followed by `… and 3 more errors, listed in xray-report.json`; the report has them all.

If the build failed without an error Xray could pick out, `dotnet build`'s own output follows on stderr.

With `--no-build`, the build is left out of `Time`, and the Reconstruction is Unverified, unless it has an Unresolved Dependency, which makes it Partial all the same:

```text
Build               skipped (--no-build), so the Recovered Solution was not verified
Time                712 ms: analyse 88 ms, decompile 614 ms, resolve dependencies 6 ms, generate 4 ms
Outcome             Unverified: not built, so neither Full nor Partial
Report              xray-report.json
```

## Exit codes

| Exit code | Meaning |
|---|---|
| 0 | A Full Reconstruction: the Recovered Solution was written and built, and, with `--run`, its program exited (whatever its exit code), launched, or was skipped as it cannot run here. With `--no-build`, the Recovered Solution was written and not built, and has no Unresolved Dependency. Either way, so was `xray-report.json`. |
| 1 | Xray could not finish: no such file, a folder with no Assembly in it or none it can tell is the application's, unreadable or corrupt metadata, an output directory it will not write to, a target framework it cannot tell (the Assembly's or a Sibling Assembly's), or an engine failure. Nothing is written. |
| 2 | The command line could not be understood. |
| 3 | Rejected: not a Managed Assembly, but a Native Executable or not a PE file. Nothing is written. |
| 4 | A Partial Reconstruction: the Recovered Solution was written but has an Unresolved Dependency, built or not, or did not build (as when a reference is left out of a cycle), or, with `--run`, its program crashed, timed out or failed to start. `xray-report.json` says why. |
