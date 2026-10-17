using System.Buffers.Binary;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using ICSharpCode.Decompiler.CSharp;

namespace Xray.Engine.Tests;

public sealed class DebugSymbolsTests : IDisposable
{
    /// <summary>This assembly, which declares the types in DebugSymbolSubjects.cs, built with a portable PDB beside it.</summary>
    internal static readonly string Subjects = typeof(DebugSymbolsTests).Assembly.Location;

    internal static readonly string SubjectsPdb = Path.ChangeExtension(Subjects, ".pdb");

    /// <summary>The engine's own PDB: a portable PDB, but another assembly's.</summary>
    internal static readonly string EnginePdb = Path.ChangeExtension(PeClassifierTests.ManagedAssembly, ".pdb");

    private readonly List<string> scratchFolders = [];

    public void Dispose()
    {
        foreach (var folder in scratchFolders)
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    private string Scratch(string name, byte[] bytes)
    {
        var folder = Directory.CreateTempSubdirectory("xray-symbols-").FullName;
        scratchFolders.Add(folder);
        var path = Path.Combine(folder, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    [Fact]
    public void OpensTheAssemblysOwnPortablePdb()
    {
        Assert.Equal(new PdbCheck(PdbFormat.Portable, null), DebugSymbols.Check(Subjects, SubjectsPdb));
    }

    [Fact]
    public void RefusesAnotherBuildsPdb()
    {
        Assert.Equal(new PdbCheck(PdbFormat.Portable, PdbMismatch.OtherBuild), DebugSymbols.Check(Subjects, EnginePdb));
        Assert.Null(DebugSymbols.Open(Subjects, EnginePdb, out _));
    }

    [Fact]
    public void RefusesAPdbForAnAssemblyThatRecordsNone()
    {
        // As if built without debug information: no debug directory, so no CodeView entry naming a PDB.
        var image = File.ReadAllBytes(Subjects);
        using (var reader = new PEReader(new MemoryStream(image)))
        {
            var headers = reader.PEHeaders;
            Assert.Equal(PEMagic.PE32, headers.PEHeader!.Magic);
            // The PE32 optional header's data directories start 96 bytes in; the debug directory is the seventh.
            BinaryPrimitives.WriteInt32LittleEndian(image.AsSpan(headers.PEHeaderStartOffset + 96 + (6 * 8) + 4), 0);
        }

        var assembly = Scratch("Subjects.dll", image);

        Assert.Equal(new PdbCheck(PdbFormat.Portable, PdbMismatch.Unrecorded), DebugSymbols.Check(assembly, SubjectsPdb));
    }

    [Fact]
    public void RefusesAFileThatIsNoPdb()
    {
        Assert.Equal(
            new PdbCheck(null, PdbMismatch.Unreadable),
            DebugSymbols.Check(Subjects, Scratch("Subjects.pdb", "not a PDB"u8.ToArray())));
        Assert.Equal(
            new PdbCheck(null, PdbMismatch.Unreadable),
            DebugSymbols.Check(Subjects, Path.Combine(AppContext.BaseDirectory, "no-such-file.pdb")));
    }

    [Fact]
    public void RefusesAPdbThatCannotBeRead()
    {
        // A portable PDB's signature, then nothing it should hold.
        var truncated = File.ReadAllBytes(SubjectsPdb)[..64];

        Assert.Equal(
            new PdbCheck(PdbFormat.Portable, PdbMismatch.Unreadable),
            DebugSymbols.Check(Subjects, Scratch("Subjects.pdb", truncated)));
    }

    [Theory]
    [InlineData("Xray.Engine.Tests.Subjects", "Tally", "DebugSymbolSubjects.cs")]
    [InlineData("Xray.Engine.Tests.Other", "Neighbour", "DebugSymbolSubjects.cs")]
    [InlineData("", "GlobalSubject", "DecompilerSubjects.cs")]
    // Its code is all in a type nested in it.
    [InlineData("Xray.Engine.Tests.Subjects", "Defaults", "DecompilerSubjects.cs")]
    // Partial: where most of its own methods are, not where most of its lambdas are.
    [InlineData("Xray.Engine.Tests.Subjects", "Halves", "DebugSymbolSubjects.cs")]
    // No code at all: only the type documents the compiler records find it.
    [InlineData("Xray.Engine.Tests.Subjects", "ICounted", "DebugSymbolSubjects.cs")]
    public void FindsTheSourceFileEachTopLevelTypeWasDeclaredIn(string ns, string name, string file)
    {
        using var symbols = DebugSymbols.Open(Subjects, SubjectsPdb, out _)!;
        using var reader = new PEReader(File.OpenRead(Subjects));
        var metadata = reader.GetMetadataReader();
        var type = metadata.TypeDefinitions.Single(handle =>
            metadata.StringComparer.Equals(metadata.GetTypeDefinition(handle).Namespace, ns)
            && metadata.StringComparer.Equals(metadata.GetTypeDefinition(handle).Name, name));

        var document = symbols.DocumentOf(type);

        Assert.Equal(file, Path.GetFileName(document));
        Assert.True(Path.IsPathRooted(document), document);
    }

    [Fact]
    public void NamesEachMethodsLocalsAsThePdbDoes()
    {
        using var symbols = DebugSymbols.Open(Subjects, SubjectsPdb, out _)!;
        var sum = (MethodDefinitionHandle)System.Reflection.Metadata.Ecma335.MetadataTokens.EntityHandle(
            typeof(Subjects.Tally).GetMethod(nameof(Tests.Subjects.Tally.Sum))!.MetadataToken);

        Assert.Contains("runningTotal", symbols.GetVariables(sum).Select(variable => variable.Name));
        Assert.True(symbols.TryGetName(sum, symbols.GetVariables(sum).First(variable => variable.Name == "runningTotal").Index, out var name));
        Assert.Equal("runningTotal", name);
        Assert.All(symbols.GetSequencePoints(sum), point => Assert.EndsWith("DebugSymbolSubjects.cs", point.DocumentUrl));
    }

    private static readonly Lazy<DecompiledAssembly> WithPdb =
        new(() => AssemblyDecompiler.Decompile(Subjects, LanguageVersion.CSharp12_0, pdbPath: SubjectsPdb));

    /// <summary>The unit declaring a type, which may be reported as another it shares the unit with.</summary>
    private static DecompiledType UnitOf(DecompiledAssembly decompiled, string name) =>
        Assert.Single(decompiled.Types, type => type.Declares.Any(declared => declared.Name == name));

    [Fact]
    public void DecompilesLocalsWithTheNamesThePdbRecords()
    {
        var code = UnitOf(WithPdb.Value, "Tally").Code;

        Assert.Contains("int runningTotal = 0;", code);
        Assert.Contains("foreach (int value in values)", code);
        Assert.Contains("string greeting = ", code);
    }

    [Fact]
    public void DecompilesTheTypesOfEachSourceFileToOneUnitThatSaysWhereTheFileWas()
    {
        var unit = UnitOf(WithPdb.Value, "Tally");

        Assert.Equal("DebugSymbolSubjects.cs", Path.GetFileName(unit.SourcePath));
        Assert.Contains("public interface ICounted\n", unit.Code);
        Assert.Contains("namespace Xray.Engine.Tests.Other\n", unit.Code);
        Assert.Contains("public sealed class Neighbour\n", unit.Code);
        // Reported as the first of them in metadata order, which the compiler sorts by namespace.
        Assert.Equal("Neighbour", unit.Name);
        Assert.Equal(["Neighbour", "Tally", "Halves", "ICounted"], unit.Declares.Select(declared => declared.Name));
        // A partial type is declared once, in the file most of it was.
        Assert.Contains("public static int[] Mapped(int[] values)", unit.Code);
        Assert.DoesNotContain(WithPdb.Value.Types, type => Path.GetFileName(type.SourcePath) == "DebugSymbolSubjects.Lambdas.cs");
        // Each file once.
        Assert.Equal(
            WithPdb.Value.Types.Select(type => type.SourcePath).Where(path => path is not null).Distinct().Count(),
            WithPdb.Value.Types.Count(type => type.SourcePath is not null));
    }

    [Fact]
    public void KeepsFileScopedTypesWithTheirFileWhenDecompilingByThePdb()
    {
        var unit = UnitOf(WithPdb.Value, "FileScoped");

        Assert.Equal("FileScopedSubjects.cs", Path.GetFileName(unit.SourcePath));
        Assert.Equal("FileScopedSubjects", unit.SourceFile);
        Assert.Contains("file static class Helper\n", unit.Code);
        Assert.Contains("file interface IUnused\n", unit.Code);
    }

    [Fact]
    public void PutsGeneratedRegexMethodsInTheFileTheyWereDeclaredInNotTheGenerators()
    {
        // Regexes has no code but what the generator wrote, in RegexGenerator.g.cs,
        // nor has the type nested in it.
        var unit = UnitOf(WithPdb.Value, "Regexes");

        Assert.Equal("RegexSubjects.cs", Path.GetFileName(unit.SourcePath));
        Assert.Equal(["Regexes", "RegexHolder`1"], unit.Declares.Select(declared => declared.Name));
        Assert.Contains("public static partial Regex Word();", unit.Code);
        Assert.Contains("private partial Regex Digit();", unit.Code);
        Assert.DoesNotContain(WithPdb.Value.Types, type => Path.GetFileName(type.SourcePath) == "RegexGenerator.g.cs");
    }

    [Fact]
    public void IgnoresAnotherBuildsPdb()
    {
        var decompiled = AssemblyDecompiler.Decompile(Subjects, LanguageVersion.CSharp12_0, pdbPath: EnginePdb);

        Assert.All(decompiled.Types, type => Assert.Null(type.SourcePath));
        Assert.DoesNotContain("runningTotal", UnitOf(decompiled, "Tally").Code);
        Assert.DoesNotContain("greeting", UnitOf(decompiled, "Neighbour").Code);
        Assert.Contains(decompiled.Types, type => type.Name == "Neighbour" && type.Declares.Count == 1);
    }
}
