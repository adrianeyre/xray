using System.Reflection;
using ICSharpCode.Decompiler.CSharp;
using Mono.Cecil;
using Mono.Cecil.Cil;

namespace Xray.Engine.Tests;

public sealed class AssemblyDecompilerTests : IDisposable
{
    /// <summary>This assembly, which declares the types in DecompilerSubjects.cs.</summary>
    private static readonly string Subjects = typeof(AssemblyDecompilerTests).Assembly.Location;

    private static readonly Lazy<DecompiledAssembly> Decompiled =
        new(() => AssemblyDecompiler.Decompile(Subjects, LanguageVersion.CSharp12_0));

    private static DecompiledType Type(string ns, string name) =>
        Assert.Single(Decompiled.Value.Types, type => type.Namespace == ns && type.Name == name);

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
        var folder = Directory.CreateTempSubdirectory("xray-decompiler-").FullName;
        scratchFolders.Add(folder);
        var path = Path.Combine(folder, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    [Fact]
    public void DecompilesEachTopLevelTypeToAUnitDeclaringIt()
    {
        Assert.Contains("public class Pair\n", Type("Xray.Engine.Tests.Subjects", "Pair").Code);
        Assert.Contains("public class Pair<T>\n", Type("Xray.Engine.Tests.Subjects", "Pair`1").Code);
        Assert.Contains("namespace Xray.Engine.Tests.Subjects;", Type("Xray.Engine.Tests.Subjects", "Pair").Code);
        Assert.Contains("internal static class GlobalSubject\n", Type("", "GlobalSubject").Code);
        Assert.DoesNotContain("namespace", Type("", "GlobalSubject").Code);
    }

    [Fact]
    public void DeclaresNestedTypesInsideTheirTopLevelType()
    {
        Assert.DoesNotContain(Decompiled.Value.Types, type => type.Name == "Inner" || type.Name.Contains('+'));
        Assert.Contains("public sealed class Inner\n", Type("Xray.Engine.Tests.Subjects", "Pair").Code);
    }

    [Fact]
    public void RecoversNullableAnnotationsRatherThanTheAttributesThatEncodeThem()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "Pair`1").Code;

        Assert.Contains("public T? First", code);
        Assert.Contains("public string? Label", code);
        Assert.DoesNotContain("[Nullable", code);
    }

    [Fact]
    public void KeepsTheTypeOfADefaultValueWhereTheLiteralWouldChangeItsMeaning()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "Defaults").Code;

        Assert.Contains("$\"[{default(Cell)}]\"", code);
        Assert.Equal("[cell]", Tests.Subjects.Defaults.Interpolated());
    }

    [Fact]
    public void UpcastsToObjectWhereATypeTestWouldOtherwiseNotCompile()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "TypeTests").Code;

        // Without the upcasts: CS0184 and CS0039.
        Assert.Contains("((object)new Sealed()) is IUnrelated", code);
        Assert.Contains("((object)(left ?? right)) as IUnrelated", code);
        // Only where they are needed.
        Assert.Contains("return value is IRelated;", code);
        Assert.Contains("return value is IUnrelated;", code);
        Assert.False(Tests.Subjects.TypeTests.Is());
    }

    [Fact]
    public void DeclaresALocalOfAnAnonymousDelegateTypeWithVarAndLeavesTheTypeToTheCompiler()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "AnonymousDelegates").Code;

        // Its own declaration, T2 arg2 = 3, would not compile (CS1750).
        Assert.NotNull(typeof(AssemblyDecompilerTests).Assembly.GetType("<>f__AnonymousDelegate0`3"));
        Assert.Contains("var obj = (int x, int by = 3) => x * by;", code);
        Assert.DoesNotContain(Decompiled.Value.Types, type => type.Name.StartsWith("<>f__AnonymousDelegate"));
        Assert.Equal(15 + 25, Tests.Subjects.AnonymousDelegates.Scale(5));
    }

    [Fact]
    public void ParenthesizesAQueryThatEndsTheClauseAContinuationFollows()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "Continuations").Code;

        // Without the parentheses, the inner query takes the "into g" as its own: CS1931, then CS1061.
        Assert.Contains("select (from t in g\n\t\t\t\tselect Parse(t)) into g\n\t\t\twhere !g.Contains(null)", code);
        Assert.Contains("select (from t in g\n\t\t\t\tselect t.Length into n\n\t\t\t\tselect n + 1) into g", code);
        Assert.Contains("group g by (from t in g\n\t\t\t\tselect t.Length) into g", code);
        // Only where they are needed.
        Assert.Contains("group from t in g\n\t\t\t\tselect t.Length by g.Length into g", code);
        Assert.Contains("select w.ToUpperInvariant() into w", code);
        Assert.Equal([[1, 2], [3]], Tests.Subjects.Continuations.Nested([["1", "2"], ["x"], ["3"]]));
    }

    [Fact]
    public void DecompilesStateMachinesBackToIteratorsAndAsyncMethods()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "StateMachines").Code;

        Assert.Contains("public static IEnumerable<int> Countdown(int from)", code);
        Assert.Contains("yield return from--;", code);
        Assert.Contains("public static async Task<int> DoubleAsync(int value)", code);
        Assert.Contains("await Task.Yield();", code);
        Assert.Contains(
            "public static async IAsyncEnumerable<int> TicksAsync(int count, [EnumeratorCancellation] CancellationToken token = default(CancellationToken))",
            code);
        Assert.Contains("await Task.Delay(0, token).ConfigureAwait(continueOnCapturedContext: false);", code);
        // No state machine, nor the attribute naming one.
        Assert.DoesNotContain("StateMachine(", code);
        Assert.DoesNotContain("IAsyncStateMachine", code);
        Assert.DoesNotContain("MoveNext", code);
        Assert.DoesNotContain("__state", code);
    }

    [Fact]
    public void ThrowsWhereASwitchExpressionMatchesNothingRatherThanCallingTheCompilersHelper()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "Unmatched").Code;

        // Not <PrivateImplementationDetails>.ThrowSwitchExpressionException(day),
        // which no source can call (CS0103).
        Assert.Contains("throw new SwitchExpressionException(day);", code);
        Assert.Contains("using System.Runtime.CompilerServices;", code);
        Assert.DoesNotContain("PrivateImplementationDetails", code);
        Assert.Throws<System.Runtime.CompilerServices.SwitchExpressionException>(() => Tests.Subjects.Unmatched.Kind((DayOfWeek)7));
    }

    [Fact]
    public void WritesACopyMadeByAnEmptyWithExpressionAsOne()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "Copied").Code;

        // Not <Clone>$(), which C# cannot call (CS1061).
        Assert.Contains("return this with { };", code);
        Assert.DoesNotContain("Clone", code);
    }

    [Fact]
    public void KeepsARecordsOwnGetHashCodeThatReturnsZero()
    {
        // Tolerant's own; the compiler's, as Copied's, is left for the compiler to write again.
        Assert.Contains("public override int GetHashCode()\n\t{\n\t\treturn 0;\n\t}", Type("Xray.Engine.Tests.Subjects", "Tolerant").Code);
        Assert.DoesNotContain("GetHashCode", Type("Xray.Engine.Tests.Subjects", "Copied").Code);
        Assert.Equal(new Tests.Subjects.Tolerant(1.5).GetHashCode(), new Tests.Subjects.Tolerant(2).GetHashCode());
    }

    [Fact]
    public void PutsAThrowExpressionBackIntoAPrimaryConstructorsFieldInitializer()
    {
        var code = Type("Xray.Engine.Tests.Subjects", "Checked").Code;

        // Not a constructor that checks its argument, then calls base..ctor(),
        // which C# cannot (CS0117).
        Assert.Contains("public sealed class Checked(int value)\n", code);
        Assert.Contains("private readonly int positive = ((value <= 0) ? throw new ArgumentOutOfRangeException(\"value\") : value);", code);
        Assert.DoesNotContain("ctor", code);
    }

    [Fact]
    public void DeclaresFileScopedTypesAsSuchWithTheTypesThatUseThem()
    {
        // The compiler names them after their file: <FileScopedSubjects>F1A2B…__Helper.
        Assert.Matches("^<FileScopedSubjects>F[0-9A-F]{64}__Helper$", Tests.Subjects.FileScoped.HelperType.Name);

        var unit = Type("Xray.Engine.Tests.Subjects", "FileScoped");

        Assert.Equal("FileScopedSubjects", unit.SourceFile);
        Assert.Contains("file static class Helper\n", unit.Code);
        // Used by nothing, but declared in the same file.
        Assert.Contains("file interface IUnused\n", unit.Code);
        Assert.Contains("public static class FileScoped\n", unit.Code);
        Assert.Contains("return Helper.Twice(value);", unit.Code);
        Assert.Contains("typeof(Helper)", unit.Code);
        Assert.DoesNotContain(Decompiled.Value.Types, type => type.Name.StartsWith("<FileScopedSubjects>", StringComparison.Ordinal));
        Assert.All(Decompiled.Value.Types.Where(type => type != unit), type => Assert.Null(type.SourceFile));
    }

    [Fact]
    public void DeclaresAGeneratedRegexMethodAsWrittenForTheGeneratorToImplementAgain()
    {
        // The generator implemented each: its body, marked [GeneratedCode].
        Assert.Equal(
            "System.Text.RegularExpressions.Generator",
            typeof(Tests.Subjects.Regexes).GetMethod(nameof(Tests.Subjects.Regexes.Word))!.GetCustomAttribute<System.CodeDom.Compiler.GeneratedCodeAttribute>()!.Tool);

        var regexes = Type("Xray.Engine.Tests.Subjects", "Regexes").Code;
        var holder = Type("Xray.Engine.Tests.Subjects", "RegexHolder`1").Code;

        Assert.Contains("public static partial class Regexes\n", regexes);
        Assert.Contains("\t[GeneratedRegex(\"^[a-z]+$\", RegexOptions.IgnoreCase, 1000)]\n\tpublic static partial Regex Word();\n", regexes);
        // One the generator constructs at runtime is declared the same.
        Assert.Contains("\t[GeneratedRegex(\"hel+o\", RegexOptions.NonBacktracking)]\n\tinternal static partial Regex Greeting();\n", regexes);
        // Every type it is nested in is partial too.
        Assert.Contains("\tpublic static partial class Spacing\n", regexes);
        Assert.Contains("\t\tpublic static partial Regex Space();\n", regexes);
        Assert.Contains("public partial class RegexHolder<T>\n", holder);
        Assert.Contains("public sealed partial class Nested\n", holder);
        Assert.Contains("\t\t[GeneratedRegex(\"\\\\d\")]\n\t\tprivate partial Regex Digit();\n", holder);
        Assert.Contains("return Digit().IsMatch(text);", holder);
        Assert.All([regexes, holder], code =>
        {
            Assert.DoesNotContain("GeneratedCode", code);
            Assert.DoesNotContain("System.CodeDom.Compiler", code);
            Assert.DoesNotContain("System.Text.RegularExpressions.Generated", code);
            Assert.DoesNotContain(".Instance", code);
        });
    }

    [Fact]
    public void LeavesTheTypesTheRegexGeneratorWritesToIt()
    {
        // File-scoped, beside the methods it implements: <RegexGenerator_g>F1A2B…__Word_0.
        Assert.Matches(
            "^<RegexGenerator_g>F[0-9A-F]{64}__Word_[0-9]+$",
            Tests.Subjects.Regexes.Word().GetType().Name);

        Assert.DoesNotContain(
            Decompiled.Value.Types.SelectMany(type => type.Declares),
            declared => declared.Namespace == "System.Text.RegularExpressions.Generated");
        Assert.DoesNotContain(Decompiled.Value.Types, type => type.SourceFile == "RegexGenerator_g");
    }

    [Fact]
    public void FindsTheAssembliesItReferencesInTheFoldersGivenToo()
    {
        // Alone in a folder, without the deps.json that leads the decompiler to
        // ICSharpCode.Decompiler, which BlockCounter derives from.
        var alone = Scratch(Path.GetFileName(Subjects), File.ReadAllBytes(Subjects));

        string Counter(IReadOnlyList<string>? referenceDirectories) =>
            Assert.Single(
                AssemblyDecompiler.Decompile(alone, LanguageVersion.CSharp12_0, referenceDirectories: referenceDirectories).Types,
                type => type.Namespace == "Xray.Engine.Tests.Subjects" && type.Name == "BlockCounter").Code;

        // Not found, the call to its base class's method calls the override itself.
        Assert.DoesNotContain("base.VisitBlockStatement(blockStatement);", Counter(null));
        Assert.Contains("base.VisitBlockStatement(blockStatement);", Counter([AppContext.BaseDirectory]));
    }

    [Fact]
    public void SaysWhetherTheModuleWasCompiledWithUnsafeCodeAllowed()
    {
        // This assembly allows unsafe code (Xray.Engine.Tests.csproj); the engine does not.
        var engine = AssemblyDecompiler.Decompile(typeof(Session).Assembly.Location, LanguageVersion.CSharp12_0);

        Assert.True(Decompiled.Value.UnsafeCode);
        Assert.Contains("private unsafe fixed byte bytes[4];", Type("Xray.Engine.Tests.Subjects", "Buffer").Code);
        Assert.False(engine.UnsafeCode);
    }

    [Fact]
    public void LeavesTheUnverifiableCodeAttributeToTheCompiler()
    {
        // The compiler adds it to a module compiled with unsafe code allowed, and
        // would refuse it declared a second time (CS0579).
        Assert.Contains(
            typeof(AssemblyDecompilerTests).Assembly.ManifestModule.GetCustomAttributesData(),
            attribute => attribute.AttributeType.FullName == "System.Security.UnverifiableCodeAttribute");

        Assert.DoesNotContain("UnverifiableCode", Decompiled.Value.AssemblyAttributes);
    }

    [Fact]
    public void SaysWhetherTheModuleHasNullableAnnotations()
    {
        // The engine and its tests enable nullable reference types
        // (Directory.Build.props); xunit.abstractions predates them.
        var engine = AssemblyDecompiler.Decompile(typeof(Session).Assembly.Location, LanguageVersion.CSharp12_0);
        var unannotated = AssemblyDecompiler.Decompile(
            Path.Combine(AppContext.BaseDirectory, "xunit.abstractions.dll"),
            LanguageVersion.CSharp12_0);

        Assert.True(Decompiled.Value.NullableAnnotations);
        Assert.True(engine.NullableAnnotations);
        Assert.False(unannotated.NullableAnnotations);
    }

    [Fact]
    public void LeavesOutTypesTheCompilerAddsItself()
    {
        // For the code in these tests, the compiler embeds an attribute for its own
        // use and holds the bytes of u8 literals in <PrivateImplementationDetails>.
        var assembly = typeof(AssemblyDecompilerTests).Assembly;
        Assert.NotNull(assembly.GetType("Microsoft.CodeAnalysis.EmbeddedAttribute"));
        Assert.NotNull(assembly.GetType("<PrivateImplementationDetails>"));

        var names = Decompiled.Value.Types.Select(type => type.Namespace == "" ? type.Name : $"{type.Namespace}.{type.Name}").ToList();

        Assert.DoesNotContain("<Module>", names);
        Assert.DoesNotContain("<PrivateImplementationDetails>", names);
        Assert.DoesNotContain("Microsoft.CodeAnalysis.EmbeddedAttribute", names);
        Assert.Contains("Xray.Engine.Tests.AssemblyDecompilerTests", names);
    }

    [Fact]
    public void KeepsACompilerGeneratedTypeTheDecompiledCodeStillUses()
    {
        // The compiler backs `Assert.Equal([1, 2, 3], …)` (EngineHostTests) with
        // <>z__ReadOnlyArray<T>, and the decompiler writes it back as a `new` of
        // that type, so it must be declared, under a name C# accepts.
        Assert.Contains(
            "new _003C_003Ez__ReadOnlyArray<int>(new int[3] { 1, 2, 3 })",
            Type("Xray.Engine.Tests", "EngineHostTests").Code);
        Assert.Contains("internal sealed class _003C_003Ez__ReadOnlyArray<T>", Type("", "<>z__ReadOnlyArray`1").Code);
    }

    [Fact]
    public void ListsTypesInMetadataOrder()
    {
        var reflected = typeof(AssemblyDecompilerTests).Assembly.GetTypes()
            .Where(type => !type.IsNested)
            .OrderBy(type => type.MetadataToken)
            .Select(type => (type.Namespace ?? "", type.Name))
            .ToList();
        var decompiled = Decompiled.Value.Types.Select(type => (type.Namespace, type.Name)).ToList();

        Assert.Equal(reflected.Where(decompiled.Contains), decompiled);
    }

    [Fact]
    public void ReportsProgressBeforeEachTypeItDecompiles()
    {
        var reported = new List<DecompileProgress>();

        var decompiled = AssemblyDecompiler.Decompile(Subjects, LanguageVersion.CSharp12_0, reported.Add);

        // Each type, file-scoped ones too, though they are declared with the types that use them.
        var fileScoped = typeof(AssemblyDecompilerTests).Assembly.GetTypes()
            .Where(type => type.Name.StartsWith("<FileScopedSubjects>F", StringComparison.Ordinal))
            .Select(type => $"{type.Namespace}.{type.Name}")
            .ToList();
        var total = decompiled.Types.Count + fileScoped.Count;
        Assert.Equal(2, fileScoped.Count);
        // Several at once, so how many are done can stay the same from one to
        // the next, but never goes down, nor counts a type not yet reported.
        Assert.Equal(total, reported.Count);
        Assert.All(reported.Select((progress, position) => (progress.Done, position)), line => Assert.InRange(line.Done, 0, line.position));
        Assert.Equal(reported.Select(progress => progress.Done).Order(), reported.Select(progress => progress.Done));
        Assert.All(reported, progress => Assert.Equal(total, progress.Total));
        Assert.Equal(
            decompiled.Types.Select(type => type.Namespace == "" ? type.Name : $"{type.Namespace}.{type.Name}").Concat(fileScoped).Order(),
            reported.Select(progress => progress.Current).Order());
    }

    [Fact]
    public void DecompilesTheSameSourceHoweverItsTypesFallBetweenThreads()
    {
        static IEnumerable<string> Units(DecompiledAssembly decompiled) =>
            decompiled.Types.Select(type => $"{string.Join(", ", type.Declares)}\n{type.SourceFile}\n{type.SourcePath}\n{type.Code}");

        var again = AssemblyDecompiler.Decompile(Subjects, LanguageVersion.CSharp12_0);

        Assert.Equal(Units(Decompiled.Value), Units(again));
        Assert.Equal(Decompiled.Value.AssemblyAttributes, again.AssemblyAttributes);
    }

    [Fact]
    public void EndsEveryLineWithALineFeed()
    {
        Assert.All(Decompiled.Value.Types, type => Assert.DoesNotContain("\r", type.Code));
        Assert.DoesNotContain("\r", Decompiled.Value.AssemblyAttributes);
    }

    [Fact]
    public void DeclaresTheAssemblyAttributesButNotThoseTheCompilerOrSdkGenerates()
    {
        var engine = AssemblyDecompiler.Decompile(typeof(Session).Assembly.Location, LanguageVersion.CSharp12_0);

        // <Version>0.0.0</Version> in Xray.Engine.csproj.
        Assert.Contains("[assembly: AssemblyVersion(\"0.0.0.0\")]", engine.AssemblyAttributes);
        Assert.Contains("[assembly: AssemblyTitle(\"Xray.Engine\")]", engine.AssemblyAttributes);
        Assert.Contains("[assembly: InternalsVisibleTo(\"Xray.Engine.Tests\")]", engine.AssemblyAttributes);
        Assert.DoesNotContain("TargetFramework(", engine.AssemblyAttributes);
        Assert.DoesNotContain("CompilationRelaxations(", engine.AssemblyAttributes);
        Assert.DoesNotContain("RuntimeCompatibility(", engine.AssemblyAttributes);
        Assert.DoesNotContain("RefSafetyRules(", engine.AssemblyAttributes);
    }

    [Fact]
    public void WritesCSharpOfTheLanguageVersionAskedFor()
    {
        // File-scoped namespaces came with C# 10.
        var code = AssemblyDecompiler.Decompile(Subjects, LanguageVersion.CSharp7_3)
            .Types.Single(type => type.Name == "Pair").Code;

        Assert.Contains("namespace Xray.Engine.Tests.Subjects\n{", code);
        Assert.Contains("namespace Xray.Engine.Tests.Subjects;", Type("Xray.Engine.Tests.Subjects", "Pair").Code);
    }

    [Fact]
    public void IndexesFromTheEndWhereTheFrameworkHasSystemIndex()
    {
        Assert.Contains("return values[^1];", Type("Xray.Engine.Tests.Subjects", "IndexFromEnd").Code);
    }

    [Theory]
    // .NET Framework 2.0 to 3.5, which wrote no TargetFrameworkAttribute.
    [InlineData(null, TargetRuntime.Net_2_0)]
    [InlineData(".NETFramework,Version=v4.8", TargetRuntime.Net_4_0)]
    [InlineData(".NETStandard,Version=v2.0", TargetRuntime.Net_4_0)]
    public void IndexesFromTheStartWhereTheFrameworkHasNoSystemIndex(string? targetFramework, TargetRuntime runtime)
    {
        var path = Scratch("Legacy.dll", []);
        using (var assembly = AssemblyDefinition.CreateAssembly(
            new AssemblyNameDefinition("Legacy", new Version(1, 0, 0, 0)),
            "Legacy.dll",
            new ModuleParameters { Kind = ModuleKind.Dll, Runtime = runtime }))
        {
            var module = assembly.MainModule;
            if (targetFramework is not null)
            {
                var attribute = new TypeReference("System.Runtime.Versioning", "TargetFrameworkAttribute", module, module.TypeSystem.CoreLibrary);
                var constructor = new MethodReference(".ctor", module.TypeSystem.Void, attribute) { HasThis = true };
                constructor.Parameters.Add(new ParameterDefinition(module.TypeSystem.String));
                assembly.CustomAttributes.Add(new CustomAttribute(constructor)
                {
                    ConstructorArguments = { new CustomAttributeArgument(module.TypeSystem.String, targetFramework) },
                });
            }

            var type = new TypeDefinition(
                "Legacy",
                "IndexFromEnd",
                Mono.Cecil.TypeAttributes.Public | Mono.Cecil.TypeAttributes.Abstract | Mono.Cecil.TypeAttributes.Sealed | Mono.Cecil.TypeAttributes.BeforeFieldInit,
                module.TypeSystem.Object);
            module.Types.Add(type);
            var last = new MethodDefinition(
                "Last",
                Mono.Cecil.MethodAttributes.Public | Mono.Cecil.MethodAttributes.Static | Mono.Cecil.MethodAttributes.HideBySig,
                module.TypeSystem.Int32);
            last.Parameters.Add(new ParameterDefinition("values", Mono.Cecil.ParameterAttributes.None, new ArrayType(module.TypeSystem.Int32)));
            type.Methods.Add(last);
            // values[values.Length - 1]
            var il = last.Body.GetILProcessor();
            il.Emit(OpCodes.Ldarg_0);
            il.Emit(OpCodes.Ldarg_0);
            il.Emit(OpCodes.Ldlen);
            il.Emit(OpCodes.Conv_I4);
            il.Emit(OpCodes.Ldc_I4_1);
            il.Emit(OpCodes.Sub);
            il.Emit(OpCodes.Ldelem_I4);
            il.Emit(OpCodes.Ret);
            assembly.Write(path);
        }

        var code = Assert.Single(AssemblyDecompiler.Decompile(path, LanguageVersion.CSharp12_0).Types).Code;

        Assert.Contains("return values[values.Length - 1];", code);
    }

    [Fact]
    public void RefusesANativeExecutable()
    {
        var exception = Assert.Throws<InspectionException>(
            () => AssemblyDecompiler.Decompile(PeClassifierTests.NativeExecutable, LanguageVersion.CSharp12_0));

        Assert.Equal("not-a-managed-assembly", exception.Code);
    }

    [Fact]
    public void ReportsCorruptMetadata()
    {
        var bytes = File.ReadAllBytes(typeof(Session).Assembly.Location);
        AssemblyInspectorTests.PeImage.CorruptMetadataSignature(bytes);

        var exception = Assert.Throws<InspectionException>(
            () => AssemblyDecompiler.Decompile(Scratch("Corrupt.dll", bytes), LanguageVersion.CSharp12_0));

        Assert.Equal("invalid-metadata", exception.Code);
    }

    [Fact]
    public void AMissingFileThrows()
    {
        Assert.Throws<FileNotFoundException>(
            () => AssemblyDecompiler.Decompile(Path.Combine(AppContext.BaseDirectory, "no-such-file.dll"), LanguageVersion.CSharp12_0));
    }
}
