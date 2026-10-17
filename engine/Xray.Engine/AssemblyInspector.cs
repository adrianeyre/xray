using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;

namespace Xray.Engine;

/// <summary>An assembly's name, as its definition or a reference to it records it.</summary>
/// <param name="Culture"><c>null</c> for the neutral culture.</param>
/// <param name="PublicKeyToken">Lower-case hex, or <c>null</c> when the assembly is not strong-named.</param>
internal sealed record AssemblyIdentity(string Name, string Version, string? Culture, string? PublicKeyToken);

/// <summary>The method the runtime starts a program at.</summary>
/// <param name="Type">The declaring type's full name, nested types joined with <c>+</c>.</param>
internal sealed record EntryPoint(string Type, string Method);

/// <summary>
/// What a Managed Assembly's headers and metadata say about it, as recorded:
/// the engine reports facts and leaves interpreting them to core.
/// </summary>
/// <param name="TargetFramework">The <c>TargetFrameworkAttribute</c>'s framework name, e.g. <c>.NETCoreApp,Version=v8.0</c>.</param>
/// <param name="TargetPlatform">The <c>TargetPlatformAttribute</c>'s platform name, e.g. <c>Windows7.0</c>.</param>
/// <param name="RuntimeVersion">The CLR version the metadata was written for, e.g. <c>v4.0.30319</c>.</param>
/// <param name="InformationalVersion">The <c>AssemblyInformationalVersionAttribute</c>'s version, e.g. <c>13.0.3+0a2e291c</c>: often the version of the package it ships in.</param>
/// <param name="Pe32Plus">Whether the PE optional header is PE32+ (64-bit) rather than PE32.</param>
/// <param name="EntryPoint"><c>null</c> for a library, or when the entry point is native code.</param>
/// <param name="TypeCount">Every type defined, nested and compiler-generated ones included, but not <c>&lt;Module&gt;</c>.</param>
/// <param name="MethodCount">Every method defined, constructors and accessors included.</param>
/// <param name="ResourceCount">Every manifest resource, embedded or linked.</param>
/// <param name="Obfuscation">The marks of obfuscation it holds, as counted.</param>
internal sealed record AssemblyMetadata(
    AssemblyIdentity Assembly,
    IReadOnlyList<AssemblyIdentity> References,
    string? TargetFramework,
    string? TargetPlatform,
    string RuntimeVersion,
    string? InformationalVersion,
    Machine Machine,
    bool Pe32Plus,
    CorFlags CorFlags,
    Subsystem Subsystem,
    EntryPoint? EntryPoint,
    int TypeCount,
    int MethodCount,
    int ResourceCount,
    ObfuscationEvidence Obfuscation);

/// <summary>Why a file could not be inspected or decompiled, with the protocol error code to report.</summary>
internal sealed class InspectionException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>Reads a Managed Assembly's metadata without loading or running any of it.</summary>
internal static class AssemblyInspector
{
    public static AssemblyMetadata Inspect(string path)
    {
        // Classified first, so anything without a CLI header is refused before
        // PEReader can mistake it for something else.
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
            return Inspect(reader);
        }
        catch (BadImageFormatException exception)
        {
            throw new InspectionException(
                Protocol.ErrorCodes.InvalidMetadata,
                $"{path} has a CLI header but its metadata could not be read: {exception.Message}");
        }
    }

    private static AssemblyMetadata Inspect(PEReader reader)
    {
        var headers = reader.PEHeaders;
        var corHeader = headers.CorHeader!;
        var metadata = reader.GetMetadataReader();
        if (!metadata.IsAssembly)
        {
            throw new BadImageFormatException("it is a module without an assembly manifest.");
        }

        var definition = metadata.GetAssemblyDefinition();
        return new AssemblyMetadata(
            Assembly: IdentityOf(metadata),
            References: metadata.AssemblyReferences
                .Select(handle => metadata.GetAssemblyReference(handle))
                .Select(reference => Identity(
                    metadata,
                    reference.Name,
                    reference.Version,
                    reference.Culture,
                    reference.PublicKeyOrToken,
                    isFullKey: (reference.Flags & AssemblyFlags.PublicKey) != 0))
                .ToList(),
            TargetFramework: StringAttribute(metadata, definition.GetCustomAttributes(), "System.Runtime.Versioning", "TargetFrameworkAttribute"),
            TargetPlatform: StringAttribute(metadata, definition.GetCustomAttributes(), "System.Runtime.Versioning", "TargetPlatformAttribute"),
            RuntimeVersion: metadata.MetadataVersion,
            InformationalVersion: StringAttribute(metadata, definition.GetCustomAttributes(), "System.Reflection", "AssemblyInformationalVersionAttribute"),
            Machine: headers.CoffHeader.Machine,
            Pe32Plus: headers.PEHeader!.Magic == PEMagic.PE32Plus,
            CorFlags: corHeader.Flags,
            Subsystem: headers.PEHeader.Subsystem,
            EntryPoint: EntryPointOf(metadata, corHeader),
            // Row 1 of the TypeDef table is always <Module>, the holder of global members.
            TypeCount: Math.Max(0, metadata.TypeDefinitions.Count - 1),
            MethodCount: metadata.MethodDefinitions.Count,
            ResourceCount: metadata.ManifestResources.Count,
            Obfuscation: ObfuscationScanner.Scan(reader, metadata));
    }

    /// <summary>The assembly's own name, as its definition records it.</summary>
    internal static AssemblyIdentity IdentityOf(MetadataReader metadata)
    {
        var definition = metadata.GetAssemblyDefinition();
        return Identity(metadata, definition.Name, definition.Version, definition.Culture, definition.PublicKey, isFullKey: true);
    }

    private static AssemblyIdentity Identity(
        MetadataReader metadata,
        StringHandle name,
        Version version,
        StringHandle culture,
        BlobHandle publicKey,
        bool isFullKey)
    {
        var cultureName = metadata.GetString(culture);
        return new AssemblyIdentity(
            metadata.GetString(name),
            version.ToString(),
            cultureName == "" ? null : cultureName,
            PublicKeyToken(metadata.GetBlobBytes(publicKey), isFullKey));
    }

    /// <summary>A token is the last 8 bytes of the key's SHA-1 hash, reversed (ECMA-335 §II.6.2.1.3).</summary>
    private static string? PublicKeyToken(byte[] keyOrToken, bool isFullKey)
    {
        if (keyOrToken.Length == 0)
        {
            return null;
        }

        // Enumerable.Reverse by name: from C# 14 (the .NET 10 SDK), `array.Reverse()` binds to
        // the in-place, void MemoryExtensions.Reverse instead.
        var token = isFullKey ? Enumerable.Reverse(SHA1.HashData(keyOrToken)[^8..]).ToArray() : keyOrToken;
        return Convert.ToHexString(token).ToLowerInvariant();
    }

    private static EntryPoint? EntryPointOf(MetadataReader metadata, CorHeader corHeader)
    {
        // A native entry point (C++/CLI) is an RVA into machine code, not a method token.
        if ((corHeader.Flags & CorFlags.NativeEntryPoint) != 0 || corHeader.EntryPointTokenOrRelativeVirtualAddress == 0)
        {
            return null;
        }

        var handle = MetadataTokens.EntityHandle(corHeader.EntryPointTokenOrRelativeVirtualAddress);
        if (handle.Kind != HandleKind.MethodDefinition)
        {
            // A token into another module of a multi-module assembly.
            return null;
        }

        var method = metadata.GetMethodDefinition((MethodDefinitionHandle)handle);
        return new EntryPoint(TypeName(metadata, method.GetDeclaringType()), metadata.GetString(method.Name));
    }

    private static string TypeName(MetadataReader metadata, TypeDefinitionHandle handle)
    {
        var type = metadata.GetTypeDefinition(handle);
        var name = metadata.GetString(type.Name);
        var declaring = type.GetDeclaringType();
        if (!declaring.IsNil)
        {
            return $"{TypeName(metadata, declaring)}+{name}";
        }

        var ns = metadata.GetString(type.Namespace);
        return ns == "" ? name : $"{ns}.{name}";
    }

    /// <summary>The first string argument of the assembly attribute <paramref name="ns"/>.<paramref name="name"/>, if applied.</summary>
    /// <summary>The <c>TargetFrameworkAttribute</c>'s framework name, e.g. <c>.NETCoreApp,Version=v8.0</c>; null when it has none.</summary>
    internal static string? TargetFrameworkOf(MetadataReader metadata) =>
        StringAttribute(metadata, metadata.GetAssemblyDefinition().GetCustomAttributes(), "System.Runtime.Versioning", "TargetFrameworkAttribute");

    private static string? StringAttribute(
        MetadataReader metadata,
        CustomAttributeHandleCollection attributes,
        string ns,
        string name)
    {
        foreach (var handle in attributes)
        {
            var attribute = metadata.GetCustomAttribute(handle);
            if (!IsAttribute(metadata, attribute, ns, name))
            {
                continue;
            }

            var value = attribute.DecodeValue(StringArgumentProvider.Instance);
            if (value.FixedArguments is [{ Value: string argument }, ..])
            {
                return argument;
            }
        }

        return null;
    }

    /// <summary>Whether <paramref name="attribute"/> is an <paramref name="ns"/>.<paramref name="name"/>.</summary>
    internal static bool IsAttribute(MetadataReader metadata, CustomAttribute attribute, string ns, string name)
    {
        switch (attribute.Constructor.Kind)
        {
            case HandleKind.MemberReference:
                var parent = metadata.GetMemberReference((MemberReferenceHandle)attribute.Constructor).Parent;
                if (parent.Kind != HandleKind.TypeReference)
                {
                    return false;
                }

                var reference = metadata.GetTypeReference((TypeReferenceHandle)parent);
                return metadata.StringComparer.Equals(reference.Namespace, ns)
                    && metadata.StringComparer.Equals(reference.Name, name);
            case HandleKind.MethodDefinition:
                var definition = metadata.GetTypeDefinition(
                    metadata.GetMethodDefinition((MethodDefinitionHandle)attribute.Constructor).GetDeclaringType());
                return metadata.StringComparer.Equals(definition.Namespace, ns)
                    && metadata.StringComparer.Equals(definition.Name, name);
            default:
                return false;
        }
    }

    /// <summary>
    /// Enough of a type provider to decode the attributes read here, whose
    /// arguments are strings: types are described by their primitive code alone.
    /// </summary>
    private sealed class StringArgumentProvider : ICustomAttributeTypeProvider<PrimitiveTypeCode>
    {
        public static readonly StringArgumentProvider Instance = new();

        public PrimitiveTypeCode GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode;

        public PrimitiveTypeCode GetSystemType() => PrimitiveTypeCode.Object;

        public PrimitiveTypeCode GetSZArrayType(PrimitiveTypeCode elementType) => PrimitiveTypeCode.Object;

        public PrimitiveTypeCode GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) =>
            PrimitiveTypeCode.Object;

        public PrimitiveTypeCode GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) =>
            PrimitiveTypeCode.Object;

        public PrimitiveTypeCode GetTypeFromSerializedName(string name) => PrimitiveTypeCode.Object;

        // Enum arguments are not expected here, and their size cannot be known
        // without loading the enum's assembly.
        public PrimitiveTypeCode GetUnderlyingEnumType(PrimitiveTypeCode type) =>
            throw new BadImageFormatException("An attribute argument was an enum, which Xray does not decode.");

        public bool IsSystemType(PrimitiveTypeCode type) => false;
    }
}
