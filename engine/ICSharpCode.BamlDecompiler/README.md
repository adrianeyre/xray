# ICSharpCode.BamlDecompiler

ILSpy's BAML decompiler, which the engine turns WPF's BAML back into XAML with
(PRD FR-12). It is ILSpy's own source, unchanged but for its line endings, as the
[`v11.1` tag](https://github.com/icsharpcode/ILSpy/tree/v11.1/ICSharpCode.BamlDecompiler)
has it (commit `a6909b2e1062d2404a52711926fa74030bd96119`), the release of the
`ICSharpCode.Decompiler` the engine uses, under ILSpy's MIT licence (see
[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md)).

It is built from source, for the engine's framework, rather than referenced as
a package: `ICSharpCode.BamlDecompiler` 11.1.0.9782 is built for `net10.0`
only, which the .NET 8 runtime Xray supports cannot load, and the last version
built for `net8.0`, 9.1.0.7988, calls members of `ICSharpCode.Decompiler` 9.1
that 11.1 has changed.

Left out of ILSpy's folder: its project file, for which
`ICSharpCode.BamlDecompiler.csproj` stands; `Properties/AssemblyInfo.cs`, which
versions it as ILSpy's build does; `Baml/KnownThings.gen.cs`, which ILSpy's
project does not compile either; and its package's readme and lock file.

To update it, copy the folder of the ILSpy tag matching the
`ICSharpCode.Decompiler` version in `engine/Directory.Packages.props` over this
one, leaving out the same files, and update the tag and commit above.
