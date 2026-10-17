using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Xml;
using ICSharpCode.Decompiler.Util;

namespace Xray.Engine;

/// <summary>Where a manifest resource's bytes are.</summary>
internal enum ResourceLocation
{
    /// <summary>In the Assembly itself, as a compiler embeds an <c>EmbeddedResource</c>.</summary>
    Embedded,

    /// <summary>In a file beside it, another file of a multi-file assembly (<c>csc /linkresource</c>).</summary>
    File,

    /// <summary>In another assembly, which the manifest refers it to.</summary>
    Assembly,
}

/// <summary>What an entry of a <c>.resources</c> file holds.</summary>
internal enum ResourceEntryKind
{
    String,
    Bytes,
    Stream,
}

/// <summary>
/// An entry of a <c>.resources</c> file that a <c>.resx</c> built by the .NET
/// SDK can hold again: a string of characters XML can hold, a byte[] or a
/// stream.
/// </summary>
/// <param name="Text">For <see cref="ResourceEntryKind.String"/>, the string; otherwise null.</param>
/// <param name="Bytes">For <see cref="ResourceEntryKind.Bytes"/> and <see cref="ResourceEntryKind.Stream"/>, every byte; otherwise null.</param>
internal sealed record ResourceEntry(string Name, ResourceEntryKind Kind, string? Text, byte[]? Bytes);

/// <summary>A resource of an Assembly's manifest, as recorded, with its bytes, where it embeds them.</summary>
/// <param name="Name">Its logical name, which <c>GetManifestResourceStream</c> asks for, e.g. <c>App.Strings.resources</c>.</param>
/// <param name="Public">Whether it is public, as a compiler makes every resource unless told otherwise, rather than private to its Assembly.</param>
/// <param name="LinkedTo">
/// For <see cref="ResourceLocation.File"/>, the file's name; for
/// <see cref="ResourceLocation.Assembly"/>, the assembly's; otherwise null.
/// </param>
/// <param name="Bytes">
/// For an embedded resource, every byte, unless <paramref name="Entries"/>
/// gives them; otherwise null.
/// </param>
/// <param name="Entries">
/// For an embedded <c>.resources</c> file (by its name) whose every entry is a
/// string, a byte[] or a stream, each of them, in the order the file holds
/// them; otherwise null.
/// </param>
/// <param name="NotDecoded">
/// For an embedded <c>.resources</c> file whose entries are not given, why,
/// for people; otherwise null.
/// </param>
internal sealed record ManifestResource(
    string Name,
    bool Public,
    ResourceLocation Location,
    string? LinkedTo,
    byte[]? Bytes,
    IReadOnlyList<ResourceEntry>? Entries,
    string? NotDecoded);

/// <summary>An Assembly's name, and every resource of its manifest, in metadata order.</summary>
internal sealed record AssemblyResources(AssemblyIdentity Assembly, IReadOnlyList<ManifestResource> Resources);

/// <summary>
/// The decoded entries of a <c>.resources</c> file, or why there are none.
/// </summary>
internal sealed record ResourcesDecoding(IReadOnlyList<ResourceEntry>? Entries, string? NotDecoded);

/// <summary>
/// Reads an Assembly's manifest resources, and the entries of each
/// <c>.resources</c> file among them, without loading or running any of it.
/// What becomes of them in a project is core's business.
/// </summary>
internal static class ManifestResources
{
    private const string ResourcesExtension = ".resources";

    public static AssemblyResources Read(string path)
    {
        // Classified first, as for "inspect", so anything without a CLI header
        // is refused before PEReader can mistake it for something else.
        if (PeClassifier.Classify(path).Kind != InputKind.ManagedAssembly)
        {
            throw new InspectionException(
                Protocol.ErrorCodes.NotAManagedAssembly,
                $"{path} is not a Managed Assembly.");
        }

        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        using var reader = new PEReader(stream);
        try
        {
            return Read(reader);
        }
        catch (BadImageFormatException exception)
        {
            throw new InspectionException(
                Protocol.ErrorCodes.InvalidMetadata,
                $"{path} has a CLI header but its metadata could not be read: {exception.Message}");
        }
    }

    private static AssemblyResources Read(PEReader reader)
    {
        var metadata = reader.GetMetadataReader();
        if (!metadata.IsAssembly)
        {
            throw new BadImageFormatException("it is a module without an assembly manifest.");
        }

        var resources = new List<ManifestResource>();
        foreach (var handle in metadata.ManifestResources)
        {
            var resource = metadata.GetManifestResource(handle);
            var name = metadata.GetString(resource.Name);
            var isPublic = (resource.Attributes & ManifestResourceAttributes.VisibilityMask) == ManifestResourceAttributes.Public;
            var implementation = resource.Implementation;
            if (!implementation.IsNil)
            {
                var (location, linkedTo) = implementation.Kind == HandleKind.AssemblyFile
                    ? (ResourceLocation.File, metadata.GetString(metadata.GetAssemblyFile((AssemblyFileHandle)implementation).Name))
                    : (ResourceLocation.Assembly, metadata.GetString(metadata.GetAssemblyReference((AssemblyReferenceHandle)implementation).Name));
                resources.Add(new ManifestResource(name, isPublic, location, linkedTo, null, null, null));
                continue;
            }

            var bytes = EmbeddedBytes(reader, resource.Offset);
            var decoding = name.EndsWith(ResourcesExtension, StringComparison.OrdinalIgnoreCase) ? Decode(bytes) : null;
            resources.Add(new ManifestResource(
                name,
                isPublic,
                ResourceLocation.Embedded,
                LinkedTo: null,
                Bytes: decoding?.Entries is null ? bytes : null,
                Entries: decoding?.Entries,
                NotDecoded: decoding?.NotDecoded));
        }

        return new AssemblyResources(AssemblyInspector.IdentityOf(metadata), resources);
    }

    /// <summary>
    /// An embedded resource's bytes: at its offset into the CLI header's
    /// resources directory, after their length, a 4-byte integer (ECMA-335 §II.24.2.4).
    /// </summary>
    private static byte[] EmbeddedBytes(PEReader reader, long offset)
    {
        var directory = reader.PEHeaders.CorHeader!.ResourcesDirectory;
        if (offset < 0 || offset > directory.Size - sizeof(int))
        {
            throw new BadImageFormatException($"a manifest resource lies outside the resources directory, at offset {offset}.");
        }

        var block = reader.GetSectionData(directory.RelativeVirtualAddress);
        if (block.Length < directory.Size)
        {
            throw new BadImageFormatException("the resources directory lies outside the Assembly's sections.");
        }

        var blob = block.GetReader((int)offset, directory.Size - (int)offset);
        var length = blob.ReadInt32();
        if (length < 0 || length > blob.RemainingBytes)
        {
            throw new BadImageFormatException($"a manifest resource of {length} bytes runs past the resources directory.");
        }

        return blob.ReadBytes(length);
    }

    /// <summary>
    /// Reads a <c>.resources</c> file's entries, if every one is a string, a
    /// byte[] or a stream: those a <c>.resx</c> built by the .NET SDK holds
    /// without <c>System.Resources.Extensions</c>, strings inline, the others
    /// as files it refers to (<c>ResXFileRef</c>). Any other value, such as an
    /// int or an object serialized by <c>BinaryFormatter</c> (a WinForms
    /// <c>Bitmap</c>), is not given, nor is a string or a name holding a
    /// character XML cannot (<c>U+0001</c>), nor a file that cannot be read.
    /// </summary>
    internal static ResourcesDecoding Decode(byte[] bytes)
    {
        var entries = new List<ResourceEntry>();
        try
        {
            using var file = new ResourcesFile(new MemoryStream(bytes, writable: false), leaveOpen: false);
            foreach (var (name, value) in file)
            {
                // A .resx is XML, which cannot hold every character a string can.
                if (UnwritableCharacter(name) is { } inName)
                {
                    return new ResourcesDecoding(null, $"The name of one of its entries holds {inName}, which no .resx can hold.");
                }

                if (value is string written && UnwritableCharacter(written) is { } inValue)
                {
                    return new ResourcesDecoding(null, $"Its entry \"{name}\" holds {inValue}, which no .resx can hold.");
                }

                switch (value)
                {
                    case string text:
                        entries.Add(new ResourceEntry(name, ResourceEntryKind.String, text, null));
                        break;
                    case byte[] data:
                        entries.Add(new ResourceEntry(name, ResourceEntryKind.Bytes, null, data));
                        break;
                    case MemoryStream data:
                        entries.Add(new ResourceEntry(name, ResourceEntryKind.Stream, null, data.ToArray()));
                        break;
                    default:
                        var type = value switch
                        {
                            null => "null",
                            ResourceSerializedObject serialized => $"a serialized {serialized.TypeName ?? "object"}",
                            _ => $"a {value.GetType().FullName}",
                        };
                        return new ResourcesDecoding(
                            null,
                            $"Its entry \"{name}\" is {type}, not a string, a byte[] or a stream.");
                }
            }
        }
        catch (Exception exception) when (exception is BadImageFormatException or EndOfStreamException or IOException or ArgumentException or InvalidOperationException or NotSupportedException or FormatException)
        {
            return new ResourcesDecoding(null, $"It could not be read as a .resources file: {exception.Message}");
        }

        return new ResourcesDecoding(entries, null);
    }

    /// <summary>
    /// The first character of <paramref name="text"/> that XML 1.0 cannot
    /// hold, even escaped, as <c>U+0001</c>; null if there is none.
    /// </summary>
    private static string? UnwritableCharacter(string text)
    {
        for (var index = 0; index < text.Length; index++)
        {
            var c = text[index];
            if (char.IsHighSurrogate(c) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]))
            {
                index++;
                continue;
            }

            if (!XmlConvert.IsXmlChar(c))
            {
                return $"U+{(int)c:X4}";
            }
        }

        return null;
    }
}
