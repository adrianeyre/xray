using System.Reflection.PortableExecutable;
using System.Text;
using Mono.Cecil;
using Mono.Cecil.Cil;
using MethodAttributes = Mono.Cecil.MethodAttributes;
using TypeAttributes = Mono.Cecil.TypeAttributes;
using FieldAttributes = Mono.Cecil.FieldAttributes;
using PropertyAttributes = Mono.Cecil.PropertyAttributes;

namespace Xray.Engine.Tests;

public sealed class ObfuscationScannerTests : IDisposable
{
    private readonly List<string> scratchFolders = [];

    public void Dispose()
    {
        foreach (var folder in scratchFolders)
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    private static ObfuscationEvidence Scan(string path)
    {
        using var stream = File.OpenRead(path);
        using var reader = new PEReader(stream);
        return ObfuscationScanner.Scan(reader, System.Reflection.Metadata.PEReaderExtensions.GetMetadataReader(reader));
    }

    /// <summary>Writes an assembly <paramref name="build"/> fills in, as an obfuscator might have left it, and scans it.</summary>
    private ObfuscationEvidence ScanBuilt(Action<ModuleDefinition> build)
    {
        var folder = Directory.CreateTempSubdirectory("xray-obfuscation-").FullName;
        scratchFolders.Add(folder);
        var path = Path.Combine(folder, "Subject.dll");
        using (var assembly = AssemblyDefinition.CreateAssembly(
            new AssemblyNameDefinition("Subject", new Version(1, 0, 0, 0)),
            "Subject.dll",
            ModuleKind.Dll))
        {
            build(assembly.MainModule);
            assembly.Write(path);
        }

        return Scan(path);
    }

    private static TypeDefinition AddType(ModuleDefinition module, string ns, string name)
    {
        var type = new TypeDefinition(ns, name, TypeAttributes.Public | TypeAttributes.Class, module.TypeSystem.Object);
        module.Types.Add(type);
        return type;
    }

    private static MethodDefinition AddMethod(TypeDefinition type, string name, TypeReference returnType, MethodAttributes attributes = MethodAttributes.Public | MethodAttributes.Static)
    {
        var method = new MethodDefinition(name, attributes, returnType);
        type.Methods.Add(method);
        return method;
    }

    /// <summary>
    /// A static <c>string <paramref name="name"/>(int index)</c> of <paramref name="type"/> returning
    /// <c>Encoding.UTF8.GetString(<paramref name="data"/>, index, 1)</c>; without <paramref name="index"/>,
    /// a static <c>string <paramref name="name"/>()</c> returning the first character's.
    /// </summary>
    private static MethodDefinition AddDecoder(ModuleDefinition module, TypeDefinition type, FieldDefinition data, string name, bool index = true)
    {
        var decoder = AddMethod(type, name, module.TypeSystem.String);
        var il = decoder.Body.GetILProcessor();
        il.Emit(OpCodes.Call, module.ImportReference(typeof(Encoding).GetProperty(nameof(Encoding.UTF8))!.GetMethod));
        il.Emit(OpCodes.Ldsfld, data);
        if (index)
        {
            decoder.Parameters.Add(new ParameterDefinition(module.TypeSystem.Int32));
            il.Emit(OpCodes.Ldarg_0);
        }
        else
        {
            il.Emit(OpCodes.Ldc_I4_0);
        }

        il.Emit(OpCodes.Ldc_I4_1);
        il.Emit(OpCodes.Callvirt, module.ImportReference(typeof(Encoding).GetMethod(nameof(Encoding.GetString), [typeof(byte[]), typeof(int), typeof(int)])));
        il.Emit(OpCodes.Ret);
        return decoder;
    }

    private static void Return(MethodDefinition method, params Instruction[] instructions)
    {
        var il = method.Body.GetILProcessor();
        foreach (var instruction in instructions)
        {
            il.Append(instruction);
        }

        il.Emit(OpCodes.Ret);
    }

    [Fact]
    public void ListsTheAttributesAppliedToTheAssemblyAndItsModuleOnceEach()
    {
        var evidence = ScanBuilt(module =>
        {
            // As ConfuserEx marks its output: an attribute of its own, applied to the module.
            var confusedBy = AddType(module, "", "ConfusedByAttribute");
            confusedBy.BaseType = module.ImportReference(typeof(Attribute));
            var constructor = AddMethod(
                confusedBy,
                ".ctor",
                module.TypeSystem.Void,
                MethodAttributes.Public | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName | MethodAttributes.HideBySig);
            Return(constructor);
            module.CustomAttributes.Add(new CustomAttribute(constructor));
            // A nested attribute type, referenced from another assembly, applied to both.
            var nested = module.ImportReference(typeof(Outer.MarkAttribute).GetConstructor(Type.EmptyTypes));
            module.Assembly.CustomAttributes.Add(new CustomAttribute(nested));
            module.CustomAttributes.Add(new CustomAttribute(nested));
        });

        Assert.Equal(["Xray.Engine.Tests.Outer+MarkAttribute", "ConfusedByAttribute"], evidence.Attributes);
    }

    [Fact]
    public void CountsTheNamesOfTypesAndMembersAndThoseUnprintableOrShort()
    {
        var evidence = ScanBuilt(module =>
        {
            var type = AddType(module, "\u0001", "\u200B\u200C\u200D");
            AddMethod(type, "\u202Ea", module.TypeSystem.Void).Body.GetILProcessor().Emit(OpCodes.Ret);
            type.Fields.Add(new FieldDefinition("\uE000", FieldAttributes.Private, module.TypeSystem.Int32));
            type.Fields.Add(new FieldDefinition("A", FieldAttributes.Private, module.TypeSystem.Int32));
            // The same name twice, as no C# type could declare its fields.
            type.Fields.Add(new FieldDefinition("A", FieldAttributes.Private, module.TypeSystem.String));
            type.Fields.Add(new FieldDefinition("Ordinary name", FieldAttributes.Private, module.TypeSystem.String));
            AddType(module, "", "b");
        });

        // Two types, a method and four fields; the namespace is not a name counted.
        Assert.Equal(7, evidence.Names.Count);
        Assert.Equal(3, evidence.Names.Unprintable);
        Assert.Equal(["\u200B\u200C\u200D", "\u202Ea", "\uE000"], evidence.Names.UnprintableExamples);
        Assert.Equal(5, evidence.Names.Short);
        Assert.Equal(["\u202Ea", "\uE000", "A", "b"], evidence.Names.ShortExamples);
    }

    [Fact]
    public void LeavesOutNamesTheCompilerMadeUpAndThoseNamedAfterAnotherMember()
    {
        var evidence = ScanBuilt(module =>
        {
            var type = AddType(module, "N", "Account");
            var constructor = AddMethod(
                type,
                ".ctor",
                module.TypeSystem.Void,
                MethodAttributes.Public | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName);
            Return(constructor);
            // A property, counted, and its accessor and backing field, which are not.
            var backing = new FieldDefinition("<Owner>k__BackingField", FieldAttributes.Private, module.TypeSystem.String);
            type.Fields.Add(backing);
            var getter = AddMethod(type, "get_Owner", module.TypeSystem.String, MethodAttributes.Public | MethodAttributes.SpecialName);
            Return(getter, Instruction.Create(OpCodes.Ldnull));
            var owner = new PropertyDefinition("Owner", PropertyAttributes.None, module.TypeSystem.String) { GetMethod = getter };
            type.Properties.Add(owner);
            // An explicit interface implementation.
            Return(AddMethod(type, "System.IDisposable.Dispose", module.TypeSystem.Void, MethodAttributes.Private | MethodAttributes.Virtual));
            // A lambda's closure class and what it holds.
            var closure = new TypeDefinition("", "<>c", TypeAttributes.NestedPrivate | TypeAttributes.Class, module.TypeSystem.Object);
            type.NestedTypes.Add(closure);
            Return(AddMethod(closure, "<Main>b__0_0", module.TypeSystem.Void));
            closure.Fields.Add(new FieldDefinition("x", FieldAttributes.Public, module.TypeSystem.Int32));
            // An enum's value__.
            var kind = new TypeDefinition("N", "Kind", TypeAttributes.Public | TypeAttributes.Sealed, module.ImportReference(typeof(Enum)));
            kind.Fields.Add(new FieldDefinition("value__", FieldAttributes.Public | FieldAttributes.SpecialName | FieldAttributes.RTSpecialName, module.TypeSystem.Int32));
            module.Types.Add(kind);
        });

        // Account, Owner and Kind.
        Assert.Equal(3, evidence.Names.Count);
        Assert.Equal(0, evidence.Names.Short);
    }

    [Fact]
    public void CountsCallsFromOtherTypesToStringDecodersAgainstLiterals()
    {
        var evidence = ScanBuilt(module =>
        {
            var strings = AddType(module, "<PrivateImplementationDetails>{0}", "Strings");
            var data = new FieldDefinition("data", FieldAttributes.Static | FieldAttributes.Assembly, module.ImportReference(typeof(byte[])));
            strings.Fields.Add(data);
            var decoder = AddDecoder(module, strings, data, "A");
            // Each string its own accessor, as Obfuscar hides them: string a() => A(1).
            var accessor = AddMethod(strings, "a", module.TypeSystem.String);
            Return(accessor, Instruction.Create(OpCodes.Ldc_I4_1), Instruction.Create(OpCodes.Call, decoder));
            // Not a string decoder, though of the same type: it takes a string; and a literal in it is not counted.
            var notADecoder = AddMethod(strings, "B", module.TypeSystem.String);
            notADecoder.Parameters.Add(new ParameterDefinition(module.TypeSystem.String));
            Return(notADecoder, Instruction.Create(OpCodes.Ldstr, "not counted"));

            var program = AddType(module, "A", "a");
            var main = AddMethod(program, "A", module.TypeSystem.Void);
            var writeLine = module.ImportReference(typeof(Console).GetMethod(nameof(Console.WriteLine), [typeof(string)]));
            Return(
                main,
                Instruction.Create(OpCodes.Ldc_I4_0),
                Instruction.Create(OpCodes.Call, decoder),
                Instruction.Create(OpCodes.Call, writeLine),
                Instruction.Create(OpCodes.Call, accessor),
                Instruction.Create(OpCodes.Call, writeLine),
                Instruction.Create(OpCodes.Ldstr, "x"),
                Instruction.Create(OpCodes.Call, notADecoder),
                Instruction.Create(OpCodes.Call, writeLine));
        });

        Assert.Equal(1, evidence.Strings.Literals);
        Assert.Equal(2, evidence.Strings.DecoderCalls);
        Assert.Equal(["<PrivateImplementationDetails>{0}.Strings"], evidence.Strings.DecoderTypes);
    }

    [Fact]
    public void FindsNoStringDecoderInATypeThatDoesNotDecodeBytesIntoText()
    {
        var evidence = ScanBuilt(module =>
        {
            var numbers = AddType(module, "N", "Numbers");
            var name = AddMethod(numbers, "Name", module.TypeSystem.String);
            name.Parameters.Add(new ParameterDefinition(module.TypeSystem.Int32));
            Return(
                name,
                Instruction.Create(OpCodes.Ldarga_S, name.Parameters[0]),
                Instruction.Create(OpCodes.Call, module.ImportReference(typeof(int).GetMethod(nameof(int.ToString), Type.EmptyTypes))));

            var program = AddType(module, "N", "Program");
            Return(
                AddMethod(program, "Main", module.TypeSystem.Void),
                Instruction.Create(OpCodes.Ldc_I4_0),
                Instruction.Create(OpCodes.Call, name),
                Instruction.Create(OpCodes.Pop));
        });

        Assert.Equal(0, evidence.Strings.DecoderCalls);
        Assert.Empty(evidence.Strings.DecoderTypes);
    }

    [Fact]
    public void FindsNoStringDecoderAmongPropertiesThatDecodeText()
    {
        var evidence = ScanBuilt(module =>
        {
            var resources = AddType(module, "N", "Resources");
            var data = new FieldDefinition("data", FieldAttributes.Static | FieldAttributes.Private, module.ImportReference(typeof(byte[])));
            resources.Fields.Add(data);
            var getter = AddDecoder(module, resources, data, "get_Title", index: false);
            getter.IsSpecialName = true;
            resources.Properties.Add(new PropertyDefinition("Title", PropertyAttributes.None, module.TypeSystem.String) { GetMethod = getter });

            var program = AddType(module, "N", "Program");
            Return(
                AddMethod(program, "Main", module.TypeSystem.Void),
                Instruction.Create(OpCodes.Call, getter),
                Instruction.Create(OpCodes.Pop));
        });

        Assert.Equal(0, evidence.Strings.DecoderCalls);
    }

    [Fact]
    public void PassesOverAMethodBodyItCannotReadRatherThanRefuseTheAssembly()
    {
        var folder = Directory.CreateTempSubdirectory("xray-obfuscation-").FullName;
        scratchFolders.Add(folder);
        var path = Path.Combine(folder, "Subject.dll");
        using (var assembly = AssemblyDefinition.CreateAssembly(
            new AssemblyNameDefinition("Subject", new Version(1, 0, 0, 0)),
            "Subject.dll",
            ModuleKind.Dll))
        {
            var module = assembly.MainModule;
            var type = AddType(module, "N", "Program");
            // ldc.i4 0x12345678; ret: made, below, a call whose token runs past the body's end.
            Return(AddMethod(type, "Truncated", module.TypeSystem.Int32), Instruction.Create(OpCodes.Ldc_I4, 0x12345678));
            // ldc.i4 0x06FFFFFF; pop; ldstr: made a call to a method there is no row for.
            Return(
                AddMethod(type, "Dangling", module.TypeSystem.String),
                Instruction.Create(OpCodes.Ldc_I4, 0x06FFFFFF),
                Instruction.Create(OpCodes.Pop),
                Instruction.Create(OpCodes.Ldstr, "kept"));
            assembly.Write(path);
        }

        var image = File.ReadAllBytes(path);
        Patch(image, [0x20, 0x78, 0x56, 0x34, 0x12, 0x2A], [0x28, 0x78, 0x56, 0x34, 0x12, 0x28]);
        Patch(image, [0x20, 0xFF, 0xFF, 0xFF, 0x06], [0x28, 0xFF, 0xFF, 0xFF, 0x06]);
        File.WriteAllBytes(path, image);

        var evidence = AssemblyInspector.Inspect(path).Obfuscation;

        // The truncated body is passed over; the dangling call is, but the rest of its body is read.
        Assert.Equal(1, evidence.Strings.Literals);
        Assert.Equal(0, evidence.Strings.DecoderCalls);
        Assert.Equal(3, evidence.Names.Count);
    }

    /// <summary>Overwrites the one occurrence of <paramref name="find"/> in <paramref name="image"/> with <paramref name="replacement"/>.</summary>
    private static void Patch(byte[] image, byte[] find, byte[] replacement)
    {
        var at = image.AsSpan().IndexOf(find);
        Assert.True(at >= 0);
        Assert.Equal(-1, image.AsSpan(at + 1).IndexOf(find));
        replacement.CopyTo(image, at);
    }

    [Fact]
    public void FindsNoMarksOfObfuscationInTheEngine()
    {
        var evidence = Scan(PeClassifierTests.ManagedAssembly);

        Assert.Contains("System.Runtime.Versioning.TargetFrameworkAttribute", evidence.Attributes);
        Assert.True(evidence.Names.Count > 100);
        Assert.Equal(0, evidence.Names.Unprintable);
        Assert.True(evidence.Names.Short * 10 < evidence.Names.Count);
        Assert.True(evidence.Strings.Literals > 0);
        Assert.Equal(0, evidence.Strings.DecoderCalls);
    }

    [Theory]
    [InlineData("Account", false)]
    [InlineData("Ordinary name", false)]
    [InlineData("Größe", false)]
    [InlineData("名前", false)]
    [InlineData("\U0001D49C", false)]
    [InlineData("\u0001", true)]
    [InlineData("a\u200Bb", true)]
    [InlineData("\u202E", true)]
    [InlineData("\uE000", true)]
    [InlineData("\u00A0", true)]
    [InlineData("\u2028", true)]
    [InlineData("\u0378", true)]
    public void TellsWhetherANameHoldsACharacterNoSourceFileShows(string name, bool unprintable)
    {
        Assert.Equal(unprintable, ObfuscationScanner.IsUnprintable(name));
    }

    [Fact]
    public void TellsALoneSurrogateIsUnprintable()
    {
        // Built here, as an attribute's argument, written as UTF-8, cannot hold one.
        Assert.True(ObfuscationScanner.IsUnprintable($"a{(char)0xD800}"));
        Assert.False(ObfuscationScanner.IsUnprintable("a\U0001D49C"));
    }
}

/// <summary>Holds a nested attribute type, applied to assemblies the tests write.</summary>
public static class Outer
{
    [AttributeUsage(AttributeTargets.Assembly | AttributeTargets.Module)]
    public sealed class MarkAttribute : Attribute;
}
