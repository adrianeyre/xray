# `xray inspect --json`

`xray inspect <assembly> --json` prints the metadata summary of a Managed Assembly (PRD FR-5, FR-24) as one JSON document on stdout, for scripts and CI. `xray ui` shows the same document, field by field and as printed here, as the [inspect summary](xray-ui.md#the-inspect-summary) of the Assembly it reconstructs (FR-20).

Only a Managed Assembly has a summary. Anything else is rejected exactly as without `--json`: stdout stays empty, an explanation goes to stderr, and the exit code says why.

| Exit code | Meaning | stdout |
|---|---|---|
| 0 | A Managed Assembly, summarized | the JSON document |
| 1 | Xray could not finish (no such file, a folder, unreadable or corrupt metadata, engine failure) | empty |
| 2 | The command line could not be understood | empty |
| 3 | Not a Managed Assembly: a Native Executable, or not a PE file | empty |

## Stability

`schemaVersion` is `1`. Within a schema version:

- every field below stays, with the same name, type and meaning;
- new fields may be added, and new values may be added to a field documented as an enumeration, so ignore fields you do not know and treat an unknown enumeration value as "other";
- object keys come in the order shown, but do not rely on key order.

Removing or renaming a field, or changing its type or meaning, increments `schemaVersion`.

## Fields

An *identity* is `{ name, version, culture, publicKeyToken }`, used for the Assembly itself and for each reference.

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer | The version of this schema: `1`. |
| `path` | string | The Assembly, as an absolute path. |
| `assembly` | identity | The Assembly's own name. |
| `assembly.name` | string | Its simple name, e.g. `Arithmetic`. |
| `assembly.version` | string | Its four-part version, e.g. `1.0.0.0`. |
| `assembly.culture` | string \| null | Its culture, e.g. `fr-FR`; `null` for the neutral culture. |
| `assembly.publicKeyToken` | string \| null | Its public key token, 16 lower-case hex digits; `null` when it is not strong-named. |
| `targetFramework` | object | The framework it was compiled for. |
| `targetFramework.moniker` | string \| null | The target framework moniker a project file would use, e.g. `net8.0`, `net8.0-windows7.0`, `netcoreapp3.1`, `net472`, `net40-client`, `netstandard2.0`, `net35`; `null` when it cannot be told. Without a `TargetFrameworkAttribute`, it is told from the CLR and the references: see `inferredFrom`. |
| `targetFramework.frameworkName` | string \| null | The Assembly's `TargetFrameworkAttribute`, e.g. `.NETCoreApp,Version=v8.0`; `null` when it has none (as before .NET Framework 4.0). |
| `targetFramework.runtimeVersion` | string | The CLR version its metadata was written for, e.g. `v4.0.30319` or `v2.0.50727`. |
| `targetFramework.inferredFrom` | string \| null | How `moniker` was told, for people, when the Assembly has no `TargetFrameworkAttribute` to say, as nothing built before .NET Framework 4.0 has: e.g. `CLR v2.0.50727 and its reference to System.Core 3.5.0.0`. CLR 2.0 (`v2.0.…`) is .NET Framework 2.0, 3.0 and 3.5's: an Assembly for it is `net35` if it references one of the framework's assemblies (signed with one of .NET Framework's keys) at version 3.0 or 3.5, such as `System.Core 3.5.0.0` or `WindowsBase 3.0.0.0`, else `net20`; .NET Framework 3.0 has no reference assemblies of its own to build with, so it is `net35`, which holds them. `null` when the attribute says, or when nothing tells it, as for .NET Framework 1.x (CLR `v1.…`), which no SDK-style project can target. |
| `targetFramework.support` | string | Enumeration, how far Xray supports reconstructing an Assembly for it (FR-8): `full` (.NET Framework 4.0–4.8.1, .NET Core 3.1, .NET 5 and later), `best-effort` (any other framework a project can target, such as .NET Framework 2.0 and 3.5 and `netstandard`: reconstructed all the same, with a warning), or `none` (`moniker` is `null`). |
| `architecture` | object | The processors and process bitness it runs as. |
| `architecture.platformTarget` | string \| null | Enumeration, as MSBuild's `PlatformTarget`: `AnyCPU`, `x86`, `x64`, `ARM`, `ARM64`, `Itanium`; `null` for a machine type .NET compilers do not target. |
| `architecture.prefer32Bit` | boolean | `true` for AnyCPU with "prefer 32-bit": it runs as a 32-bit process wherever the OS can. |
| `architecture.bitness` | string | Enumeration: `any` (whatever the OS is: AnyCPU), `32-bit` or `64-bit`. |
| `architecture.machine` | string | The PE header's machine type, as named by .NET's `System.Reflection.PortableExecutable.Machine` (e.g. `I386`, `Amd64`, `Arm64`), or its number when unnamed. AnyCPU Assemblies are `I386`. |
| `entryPoint` | object \| null | The method the program starts at; `null` for a library. |
| `entryPoint.type` | string | The declaring type's full name, nested types joined with `+`, e.g. `Arithmetic.Program`. Compiler-generated names are kept: top-level statements start at `Program.<Main>$`, or `Program.<Main>` when they `await`. |
| `entryPoint.method` | string | The method's name, e.g. `Main`. |
| `outputKind` | string | Enumeration: `console` (a program for the console), `winforms` or `wpf` (a Windows GUI program referencing `System.Windows.Forms` or `PresentationFramework`), `windows` (a Windows GUI program using neither), or `library` (no entry point). |
| `references` | identity[] | Every assembly it references directly, sorted by name. |
| `references[].name` | string | As `assembly.name`. |
| `references[].version` | string | The version it was compiled against. |
| `references[].culture` | string \| null | As `assembly.culture`. |
| `references[].publicKeyToken` | string \| null | As `assembly.publicKeyToken`. |
| `counts` | object | How much it defines. |
| `counts.types` | integer | Every type it defines, nested and compiler-generated types included (but not the `<Module>` pseudo-type). |
| `counts.methods` | integer | Every method it defines, constructors and property and event accessors included. |
| `counts.resources` | integer | Every manifest resource, embedded or linked. |
| `pdb` | object | The PDB beside the Assembly, named after it (`Arithmetic.pdb` beside `Arithmetic.dll`), if there is one, and whether it is the Assembly's own (FR-4, FR-5). Only the Assembly's own PDB is used by a Reconstruction: for local variable names, and to lay files out by their original source paths (see [`xray reconstruct`](xray-reconstruct.md#pdbs)). |
| `pdb.status` | string | Enumeration: `none` (there is no PDB beside it, and `pdb` has no other field), `matching` (the Assembly's own: its ID is the one the Assembly's CodeView debug directory entry records), `mismatched` (a PDB, but another build's, or the Assembly records no PDB at all, having been built without debug information) or `unreadable` (not a PDB of either format, or one that could not be read). |
| `pdb.path` | string | The PDB, as an absolute path. |
| `pdb.format` | string \| null | Enumeration: `portable` (the format the .NET SDK writes by default, on every OS) or `windows` (the older MSF format, which only Windows writes, for `DebugType` `full` or `pdbonly`); `null` for a file that is a PDB of neither format. |
| `pdb.reason` | string | Only when `mismatched` or `unreadable`: why the PDB is not used, e.g. `Arithmetic.pdb, a portable PDB, is not Arithmetic.dll's own: its ID is not the one Arithmetic.dll records, so it is another build's.` |
| `obfuscation` | object | Whether the Assembly shows signs of obfuscation (FR-3, FR-5): an obfuscator's attribute, names an obfuscator gives, or strings hidden from view. Xray only says so: an obfuscated Assembly is reconstructed as it is, never deobfuscated (see [`xray reconstruct`](xray-reconstruct.md#obfuscation), which says how each sign is found). |
| `obfuscation.status` | string | Enumeration: `clean` (no sign of obfuscation found) or `obfuscated` (likely obfuscated, by the signs in `indicators`). |
| `obfuscation.indicators` | object[] | Each sign found, in the order of `kind` below; empty when `clean`. |
| `obfuscation.indicators[].kind` | string | Enumeration. `obfuscator-attribute`: it bears an attribute a known obfuscator marks its output with (ConfuserEx's `ConfusedByAttribute`, Dotfuscator's `DotfuscatorAttribute`, SmartAssembly's `PoweredByAttribute`…), one sign for each. `mangled-identifiers`: its types and members are named as an obfuscator renames them, not as a programmer would: some of their names hold characters no source file shows, or at least half of them (of 10 or more) are one or two characters long. `encrypted-strings`: its strings are hidden: as many of them, or more, are fetched by calls to string decoders, which decode them from bytes, as are written as literals. More kinds may be added. |
| `obfuscation.indicators[].evidence` | string[] | What was found, as it is: for `obfuscator-attribute`, the attribute's full name; for `mangled-identifiers`, the first five names that are unprintable, if any are, else the first five short ones, each once; for `encrypted-strings`, the full name of each type holding the string decoders called. |
| `obfuscation.indicators[].message` | string | What was found, and how much of it, for people, as `xray inspect` prints it, e.g. `79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer.` A name's unprintable characters are written as `\uXXXX` escapes. |

## Example

The arithmetic Fixture (`fixtures/arithmetic`), a .NET 8 console program:

```json
{
  "schemaVersion": 1,
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
}
```

The `obfuscated` Fixture (`fixtures/obfuscated`), which Obfuscar renames, and whose strings it hides, as it is built, is likely obfuscated, by the names it gave it and the strings it hid. Obfuscar marks its output with no attribute of its own, and names the type it hides strings in afresh, by GUIDs, each build:

```json
{
  "obfuscation": {
    "status": "obfuscated",
    "indicators": [
      {
        "kind": "mangled-identifiers",
        "evidence": [
          "A",
          "a",
          "B",
          "b",
          "C"
        ],
        "message": "79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer."
      },
      {
        "kind": "encrypted-strings",
        "evidence": [
          "<PrivateImplementationDetails>{B9661AAF-D5F4-4AD6-9C6B-533D1B6AC7FE}.4C778FB7-5732-4E85-86A3-7EEF367292B7"
        ],
        "message": "Its strings are hidden: 23 calls fetch them from string decoders, which decode them from bytes (in <PrivateImplementationDetails>{B9661AAF-D5F4-4AD6-9C6B-533D1B6AC7FE}.4C778FB7-5732-4E85-86A3-7EEF367292B7), against 0 literals."
      }
    ]
  }
}
```
