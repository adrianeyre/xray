using System.Reflection;
using System.Reflection.PortableExecutable;
using System.Runtime.Versioning;
using ICSharpCode.Decompiler.CSharp;

namespace Xray.Engine.Tests;

public sealed class AssemblyInspectorTests : IDisposable
{
    private const BindingFlags Declared =
        BindingFlags.DeclaredOnly | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;

    /// <summary>
    /// Assemblies whose metadata reflection can read independently: the engine
    /// (an Exe with top-level statements), ICSharpCode.Decompiler (a strong-named
    /// library) and System.Private.CoreLib (which embeds resources).
    /// </summary>
    public static TheoryData<string> Assemblies => [.. Loadable().Select(assembly => assembly.Location)];

    // Each from a type of its own, which loads it: a theory may run in a
    // process other than the one that listed its data, before anything else
    // there has loaded the decompiler.
    private static Assembly[] Loadable() =>
        [typeof(Session).Assembly, typeof(CSharpDecompiler).Assembly, typeof(object).Assembly];

    private static Assembly Loaded(string path) => Loadable().Single(assembly => assembly.Location == path);

    private static string? Token(AssemblyName name) =>
        name.GetPublicKeyToken() is { Length: > 0 } token ? Convert.ToHexString(token).ToLowerInvariant() : null;

    private static AssemblyIdentity Identity(AssemblyName name) =>
        new(name.Name!, name.Version!.ToString(), name.CultureName is null or "" ? null : name.CultureName, Token(name));

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
        var folder = Directory.CreateTempSubdirectory("xray-inspector-").FullName;
        scratchFolders.Add(folder);
        var path = Path.Combine(folder, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void ReportsTheAssemblysNameAsReflectionDoes(string path)
    {
        Assert.Equal(Identity(Loaded(path).GetName()), AssemblyInspector.Inspect(path).Assembly);
    }

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void ReportsEveryReferencedAssemblyAsReflectionDoes(string path)
    {
        Assert.Equal(
            Loaded(path).GetReferencedAssemblies().Select(Identity),
            AssemblyInspector.Inspect(path).References);
    }

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void ReportsTheTargetFrameworkAttributeAsReflectionDoes(string path)
    {
        Assert.Equal(
            Loaded(path).GetCustomAttribute<TargetFrameworkAttribute>()?.FrameworkName,
            AssemblyInspector.Inspect(path).TargetFramework);
    }

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void ReportsTheInformationalVersionAsReflectionDoes(string path)
    {
        Assert.Equal(
            Loaded(path).GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
            AssemblyInspector.Inspect(path).InformationalVersion);
    }

    [Fact]
    public void ReportsTheInformationalVersionTheDecompilerShipsWith()
    {
        // ICSharpCode.Decompiler's package version, and the commit it was built from.
        Assert.StartsWith("11.1.0.", AssemblyInspector.Inspect(typeof(CSharpDecompiler).Assembly.Location).InformationalVersion);
    }

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void CountsTypesMethodsAndResourcesAsReflectionDoes(string path)
    {
        var assembly = Loaded(path);
        var types = assembly.GetTypes();
        var methods =
            types.Sum(type => type.GetMethods(Declared).Length + type.GetConstructors(Declared).Length)
            + assembly.ManifestModule.GetMethods(Declared).Length;

        var metadata = AssemblyInspector.Inspect(path);

        Assert.Equal(types.Length, metadata.TypeCount);
        Assert.Equal(methods, metadata.MethodCount);
        Assert.Equal(assembly.GetManifestResourceNames().Length, metadata.ResourceCount);
    }

    [Fact]
    public void SystemPrivateCoreLibHasResources()
    {
        Assert.NotEqual(0, AssemblyInspector.Inspect(typeof(object).Assembly.Location).ResourceCount);
    }

    [Fact]
    public void ReportsTheEntryPointOfAProgram()
    {
        // The engine's Program.cs is top-level statements that await, which
        // compile to Program.<Main>$ and the synchronous entry point that runs it.
        var entryPoint = typeof(Session).Assembly.EntryPoint!;
        Assert.Equal(("Program", "<Main>"), (entryPoint.DeclaringType!.FullName, entryPoint.Name));

        Assert.Equal(
            new EntryPoint("Program", "<Main>"),
            AssemblyInspector.Inspect(typeof(Session).Assembly.Location).EntryPoint);
    }

    [Fact]
    public void ALibraryHasNoEntryPoint()
    {
        Assert.Null(AssemblyInspector.Inspect(typeof(CSharpDecompiler).Assembly.Location).EntryPoint);
    }

    [Fact]
    public void TakesTheTokenOfAStrongNamedAssemblyFromItsFullPublicKey()
    {
        Assert.Equal("d4bfe873e7598c49", AssemblyInspector.Inspect(typeof(CSharpDecompiler).Assembly.Location).Assembly.PublicKeyToken);
    }

    [Fact]
    public void AnAnyCpuConsoleProgramIsIlOnlyPe32ForTheWindowsConsole()
    {
        var metadata = AssemblyInspector.Inspect(typeof(Session).Assembly.Location);

        Assert.Equal(".NETCoreApp,Version=v8.0", metadata.TargetFramework);
        Assert.Null(metadata.TargetPlatform);
        Assert.Equal("v4.0.30319", metadata.RuntimeVersion);
        Assert.Equal(Machine.I386, metadata.Machine);
        Assert.False(metadata.Pe32Plus);
        Assert.Equal(CorFlags.ILOnly, metadata.CorFlags);
        Assert.Equal(Subsystem.WindowsCui, metadata.Subsystem);
    }

    [Fact]
    public void ReportsCorFlagsAndSubsystemAsTheHeadersRecordThem()
    {
        // The engine as if built with <OutputType>WinExe</OutputType> and <Prefer32Bit>true</Prefer32Bit>.
        var bytes = File.ReadAllBytes(typeof(Session).Assembly.Location);
        PeImage.SetSubsystem(bytes, Subsystem.WindowsGui);
        PeImage.SetCorFlags(bytes, CorFlags.ILOnly | CorFlags.Requires32Bit | CorFlags.Prefers32Bit);

        var metadata = AssemblyInspector.Inspect(Scratch("WinExe.dll", bytes));

        Assert.Equal(Subsystem.WindowsGui, metadata.Subsystem);
        Assert.Equal(CorFlags.ILOnly | CorFlags.Requires32Bit | CorFlags.Prefers32Bit, metadata.CorFlags);
    }

    [Fact]
    public void ANativeEntryPointIsNotReportedAsAMethod()
    {
        var bytes = File.ReadAllBytes(typeof(Session).Assembly.Location);
        PeImage.SetCorFlags(bytes, CorFlags.NativeEntryPoint);

        Assert.Null(AssemblyInspector.Inspect(Scratch("Mixed.dll", bytes)).EntryPoint);
    }

    [Fact]
    public void RefusesANativeExecutable()
    {
        var exception = Assert.Throws<InspectionException>(() => AssemblyInspector.Inspect(PeClassifierTests.NativeExecutable));

        Assert.Equal("not-a-managed-assembly", exception.Code);
    }

    [Fact]
    public void RefusesAFileThatIsNotPe()
    {
        var exception = Assert.Throws<InspectionException>(
            () => AssemblyInspector.Inspect(Scratch("notes.txt", "Just some text.\n"u8.ToArray())));

        Assert.Equal("not-a-managed-assembly", exception.Code);
    }

    [Fact]
    public void ReportsCorruptMetadata()
    {
        var bytes = File.ReadAllBytes(typeof(Session).Assembly.Location);
        PeImage.CorruptMetadataSignature(bytes);

        var exception = Assert.Throws<InspectionException>(() => AssemblyInspector.Inspect(Scratch("Corrupt.dll", bytes)));

        Assert.Equal("invalid-metadata", exception.Code);
        Assert.Contains("has a CLI header but its metadata could not be read", exception.Message);
    }

    [Fact]
    public void AMissingFileThrows()
    {
        Assert.Throws<FileNotFoundException>(
            () => AssemblyInspector.Inspect(Path.Combine(AppContext.BaseDirectory, "no-such-file.dll")));
    }

    /// <summary>Edits a PE image's headers in place, to make files the build cannot.</summary>
    internal static class PeImage
    {
        // Offsets into the optional header and the CLI header (ECMA-335 §II.25.2.3.2, §II.25.3.3).
        private const int SubsystemOffset = 68;
        private const int CorFlagsOffset = 16;

        public static void SetSubsystem(byte[] image, Subsystem subsystem)
        {
            var headers = new PEHeaders(new MemoryStream(image));
            BitConverter.TryWriteBytes(image.AsSpan(headers.PEHeaderStartOffset + SubsystemOffset), (ushort)subsystem);
        }

        public static void SetCorFlags(byte[] image, CorFlags flags)
        {
            var headers = new PEHeaders(new MemoryStream(image));
            Assert.True(headers.TryGetDirectoryOffset(headers.PEHeader!.CorHeaderTableDirectory, out var corHeader));
            BitConverter.TryWriteBytes(image.AsSpan(corHeader + CorFlagsOffset), (uint)flags);
        }

        public static void CorruptMetadataSignature(byte[] image)
        {
            var headers = new PEHeaders(new MemoryStream(image));
            Assert.Equal("BSJB"u8.ToArray(), image[headers.MetadataStartOffset..(headers.MetadataStartOffset + 4)]);
            "XXXX"u8.CopyTo(image.AsSpan(headers.MetadataStartOffset));
        }
    }
}
