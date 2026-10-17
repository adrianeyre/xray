using System.Globalization;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Resources;
using System.Text;
using ICSharpCode.Decompiler.CSharp;

namespace Xray.Engine.Tests;

public sealed class ManifestResourcesTests : IDisposable
{
    private const string Phrases = "Xray.Engine.Tests.Resources.Phrases";
    private const string Blobs = "Xray.Engine.Tests.Resources.Blobs";

    private static readonly Assembly Tests = typeof(ManifestResourcesTests).Assembly;

    /// <summary>
    /// Assemblies whose manifests reflection can read independently: these
    /// tests' own, which embeds resources of every kind it is given (see the
    /// project), and System.Private.CoreLib, which embeds the strings of its
    /// messages.
    /// </summary>
    public static TheoryData<string> Assemblies => [.. Loadable().Select(assembly => assembly.Location)];

    // Each from a type of its own, which loads it: a theory may run in a
    // process other than the one that listed its data, before anything else
    // there has loaded the decompiler.
    private static Assembly[] Loadable() => [Tests, typeof(object).Assembly, typeof(CSharpDecompiler).Assembly];

    private static Assembly Loaded(string path) => Loadable().Single(assembly => assembly.Location == path);

    private static string SatellitePath(string culture) =>
        Path.Combine(Path.GetDirectoryName(Tests.Location)!, culture, "Xray.Engine.Tests.resources.dll");

    private static ManifestResource Resource(AssemblyResources read, string name) =>
        Assert.Single(read.Resources, resource => resource.Name == name);

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
        var folder = Directory.CreateTempSubdirectory("xray-resources-").FullName;
        scratchFolders.Add(folder);
        var path = Path.Combine(folder, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    /// <summary>A .resources file holding the given entries, as .NET's own writer writes one.</summary>
    private static byte[] ResourcesFile(params (string Name, object? Value)[] entries)
    {
        using var stream = new MemoryStream();
        using (var writer = new ResourceWriter(stream))
        {
            foreach (var (name, value) in entries)
            {
                writer.AddResource(name, value);
            }
        }

        return stream.ToArray();
    }

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void ReadsEveryResourceAsReflectionNamesThem(string path)
    {
        var loaded = Loaded(path);

        var read = ManifestResources.Read(path);

        Assert.Equal(
            loaded.GetManifestResourceNames().Order(StringComparer.Ordinal),
            read.Resources.Select(resource => resource.Name).Order(StringComparer.Ordinal));
        Assert.Equal(loaded.GetName().Name, read.Assembly.Name);
    }

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void GivesTheBytesOfEveryEmbeddedResourceItDoesNotDecode(string path)
    {
        var loaded = Loaded(path);

        foreach (var resource in ManifestResources.Read(path).Resources.Where(resource => resource.Entries is null))
        {
            using var stream = loaded.GetManifestResourceStream(resource.Name)!;
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            Assert.Equal(ResourceLocation.Embedded, resource.Location);
            Assert.Equal(copy.ToArray(), resource.Bytes);
        }
    }

    [Fact]
    public void ReadsAFileEmbeddedAsItIsUnderItsLogicalNameAndPrivate()
    {
        var note = Resource(ManifestResources.Read(Tests.Location), "Subjects.Note");

        Assert.Equal(
            new ManifestResource("Subjects.Note", false, ResourceLocation.Embedded, null, note.Bytes, null, null),
            note);
        Assert.Equal("A note, embedded as it is.\n", Encoding.UTF8.GetString(note.Bytes!));
    }

    [Fact]
    public void DecodesAResourcesFileOfStringsAsTheResourceManagerReadsThem()
    {
        var phrases = Resource(ManifestResources.Read(Tests.Location), $"{Phrases}.resources");
        var manager = new ResourceManager(Phrases, Tests);

        Assert.True(phrases.Public);
        Assert.Null(phrases.Bytes);
        Assert.Null(phrases.NotDecoded);
        Assert.Equal(
            ["Hello", "Lines"],
            phrases.Entries!.Select(entry => entry.Name).Order(StringComparer.Ordinal));
        foreach (var entry in phrases.Entries!)
        {
            Assert.Equal(ResourceEntryKind.String, entry.Kind);
            Assert.Null(entry.Bytes);
            Assert.Equal(manager.GetString(entry.Name, CultureInfo.InvariantCulture), entry.Text);
        }

        Assert.Equal("first\r\nsecond", phrases.Entries!.Single(entry => entry.Name == "Lines").Text);
    }

    [Fact]
    public void DecodesAResourcesFileOfBytesAndStreams()
    {
        var blobs = Resource(ManifestResources.Read(Tests.Location), $"{Blobs}.resources");

        Assert.Null(blobs.Bytes);
        var entries = blobs.Entries!.OrderBy(entry => entry.Name, StringComparer.Ordinal).ToList();
        Assert.Equal(new ResourceEntry("Blob", ResourceEntryKind.Bytes, null, entries[0].Bytes), entries[0]);
        Assert.Equal(new byte[] { 0x00, 0x01, 0x02, 0xff }, entries[0].Bytes);
        Assert.Equal(new ResourceEntry("Note", ResourceEntryKind.Stream, null, entries[1].Bytes), entries[1]);
        Assert.Equal("A note, embedded as it is.\n", Encoding.UTF8.GetString(entries[1].Bytes!));
    }

    [Fact]
    public void ReadsASatelliteAssemblysCultureAndResources()
    {
        var read = ManifestResources.Read(SatellitePath("fr"));

        Assert.Equal("Xray.Engine.Tests.resources", read.Assembly.Name);
        Assert.Equal("fr", read.Assembly.Culture);
        var phrases = Assert.Single(read.Resources);
        Assert.Equal($"{Phrases}.fr.resources", phrases.Name);
        Assert.Equal([new ResourceEntry("Hello", ResourceEntryKind.String, "Bonjour", null)], phrases.Entries);
    }

    [Theory]
    [InlineData("MaxPhrases", 42, "Its entry \"MaxPhrases\" is a System.Int32, not a string, a byte[] or a stream.")]
    [InlineData("Strict", true, "Its entry \"Strict\" is a System.Boolean, not a string, a byte[] or a stream.")]
    [InlineData("Nothing", null, "Its entry \"Nothing\" is null, not a string, a byte[] or a stream.")]
    public void DoesNotDecodeAResourcesFileHoldingAnythingElse(string name, object? value, string why)
    {
        var decoding = ManifestResources.Decode(ResourcesFile(("Motto", "Say it twice"), (name, value)));

        Assert.Equal(new ResourcesDecoding(null, why), decoding);
    }

    [Theory]
    [InlineData("Bell", "ding\u0007", "Its entry \"Bell\" holds U+0007, which no .resx can hold.")]
    [InlineData("Null\u0000", "", "The name of one of its entries holds U+0000, which no .resx can hold.")]
    public void DoesNotDecodeAResourcesFileHoldingACharacterNoResxCan(string name, string value, string why)
    {
        Assert.Equal(new ResourcesDecoding(null, why), ManifestResources.Decode(ResourcesFile((name, value))));
    }

    [Fact]
    public void DecodesStringsOfAnyCharacterXmlCanHold()
    {
        const string text = "tab\t, line\r\n, caf\u00e9, emoji \ud83d\ude00, <&>\"'";

        var decoding = ManifestResources.Decode(ResourcesFile(("Text", text)));

        Assert.Equal([new ResourceEntry("Text", ResourceEntryKind.String, text, null)], decoding.Entries);
    }

    [Fact]
    public void DoesNotDecodeWhatIsNotAResourcesFile()
    {
        var decoding = ManifestResources.Decode(Encoding.UTF8.GetBytes("not a .resources file"));

        Assert.Null(decoding.Entries);
        Assert.StartsWith("It could not be read as a .resources file: ", decoding.NotDecoded);
    }

    [Fact]
    public void DecodesAnEmptyResourcesFile()
    {
        var decoding = ManifestResources.Decode(ResourcesFile());

        Assert.Empty(decoding.Entries!);
        Assert.Null(decoding.NotDecoded);
    }

    [Fact]
    public void RefusesANativeExecutable()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "hello.exe");

        var exception = Assert.Throws<InspectionException>(() => ManifestResources.Read(path));

        Assert.Equal(Protocol.ErrorCodes.NotAManagedAssembly, exception.Code);
    }

    [Fact]
    public void RefusesAManagedAssemblyWhoseResourcesLieOutsideItsResourcesDirectory()
    {
        // These tests' own Assembly, with the offset of its first resource
        // pointed far past the directory.
        var bytes = File.ReadAllBytes(Tests.Location);
        using var reader = new PEReader(new MemoryStream(bytes));
        var metadata = reader.GetMetadataReader();
        var first = metadata.GetManifestResource(metadata.ManifestResources.First());
        // A row's first column is its offset.
        var start = reader.PEHeaders.MetadataStartOffset + metadata.GetTableMetadataOffset(TableIndex.ManifestResource);
        Assert.Equal(first.Offset, BitConverter.ToInt32(bytes, start));
        BitConverter.GetBytes(int.MaxValue - 16).CopyTo(bytes, start);

        var exception = Assert.Throws<InspectionException>(() => ManifestResources.Read(Scratch("Corrupt.dll", bytes)));

        Assert.Equal(Protocol.ErrorCodes.InvalidMetadata, exception.Code);
    }
}
