using System.Globalization;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text;
using ICSharpCode.Decompiler.Disassembler;

namespace Xray.Engine;

/// <summary>
/// What an Assembly holds of the marks obfuscators leave, as counted: the
/// engine reports them, and core decides whether they make it likely
/// obfuscated (FR-3). Nothing is undone.
/// </summary>
/// <param name="Attributes">The full name of every attribute type applied to the assembly or its module, once each, in metadata order: an obfuscator may mark its output with one of its own.</param>
internal sealed record ObfuscationEvidence(
    IReadOnlyList<string> Attributes,
    NameEvidence Names,
    StringEvidence Strings);

/// <summary>
/// The names the Assembly's source would have given its types and members: of
/// its types, methods, fields, properties and events, every one but those the
/// compiler makes up (names holding <c>&lt;</c>, and every member of a type so
/// named), constructors, an enum's <c>value__</c>, property and event accessors
/// (named after their property or event, which is counted), and explicit
/// interface implementations (named after the interface's member).
/// </summary>
/// <param name="Count">How many names were counted.</param>
/// <param name="Unprintable">How many hold a character no source file shows: a control, format, private-use, unassigned or surrogate code point, or a separator other than the space.</param>
/// <param name="Short">How many are one or two characters long.</param>
/// <param name="UnprintableExamples">The first few unprintable names, each once, as they are.</param>
/// <param name="ShortExamples">The first few short names, each once.</param>
internal sealed record NameEvidence(
    int Count,
    int Unprintable,
    int Short,
    IReadOnlyList<string> UnprintableExamples,
    IReadOnlyList<string> ShortExamples);

/// <summary>
/// Where the Assembly's strings come from: literals (<c>ldstr</c>), or calls
/// to string decoders. A string decoder is a static method returning a
/// <c>string</c>, taking nothing but integers, of a type that decodes bytes
/// into text (one of its methods calls <c>System.Text.Encoding.GetString</c>);
/// property accessors are not.
/// </summary>
/// <param name="Literals">How many <c>ldstr</c> instructions there are outside the types holding string decoders.</param>
/// <param name="DecoderCalls">How many calls there are to string decoders from outside their own type.</param>
/// <param name="DecoderTypes">The full name of each type holding a string decoder that is called so, in metadata order.</param>
internal sealed record StringEvidence(int Literals, int DecoderCalls, IReadOnlyList<string> DecoderTypes);

/// <summary>Counts the marks of obfuscation in a Managed Assembly's metadata and IL, without loading or running any of it.</summary>
internal static class ObfuscationScanner
{
    /// <summary>How many examples of a kind of name are kept.</summary>
    internal const int Examples = 5;

    public static ObfuscationEvidence Scan(PEReader reader, MetadataReader metadata) =>
        new(Attributes(metadata), Names(metadata), Strings(reader, metadata));

    private static List<string> Attributes(MetadataReader metadata) =>
        metadata.GetAssemblyDefinition().GetCustomAttributes()
            .Concat(metadata.GetModuleDefinition().GetCustomAttributes())
            .Select(handle => AttributeType(metadata, metadata.GetCustomAttribute(handle)))
            .OfType<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();

    /// <summary>The full name of an attribute's type, nested types joined with <c>+</c>; null if it is not a type's constructor.</summary>
    private static string? AttributeType(MetadataReader metadata, CustomAttribute attribute)
    {
        switch (attribute.Constructor.Kind)
        {
            case HandleKind.MemberReference:
                var parent = metadata.GetMemberReference((MemberReferenceHandle)attribute.Constructor).Parent;
                return parent.Kind switch
                {
                    HandleKind.TypeReference => TypeReferenceName(metadata, (TypeReferenceHandle)parent),
                    HandleKind.TypeDefinition => TypeDefinitionName(metadata, (TypeDefinitionHandle)parent),
                    _ => null,
                };
            case HandleKind.MethodDefinition:
                return TypeDefinitionName(
                    metadata,
                    metadata.GetMethodDefinition((MethodDefinitionHandle)attribute.Constructor).GetDeclaringType());
            default:
                return null;
        }
    }

    private static string TypeReferenceName(MetadataReader metadata, TypeReferenceHandle handle)
    {
        var reference = metadata.GetTypeReference(handle);
        var name = metadata.GetString(reference.Name);
        if (reference.ResolutionScope.Kind == HandleKind.TypeReference)
        {
            return $"{TypeReferenceName(metadata, (TypeReferenceHandle)reference.ResolutionScope)}+{name}";
        }

        var ns = metadata.GetString(reference.Namespace);
        return ns == "" ? name : $"{ns}.{name}";
    }

    private static string TypeDefinitionName(MetadataReader metadata, TypeDefinitionHandle handle)
    {
        var type = metadata.GetTypeDefinition(handle);
        var name = metadata.GetString(type.Name);
        var declaring = type.GetDeclaringType();
        if (!declaring.IsNil)
        {
            return $"{TypeDefinitionName(metadata, declaring)}+{name}";
        }

        var ns = metadata.GetString(type.Namespace);
        return ns == "" ? name : $"{ns}.{name}";
    }

    private static NameEvidence Names(MetadataReader metadata)
    {
        var count = 0;
        var unprintable = new List<string>();
        var unprintableCount = 0;
        var shortNames = new List<string>();
        var shortCount = 0;

        void Count(string name)
        {
            count++;
            if (IsUnprintable(name))
            {
                unprintableCount++;
                if (unprintable.Count < Examples && !unprintable.Contains(name, StringComparer.Ordinal))
                {
                    unprintable.Add(name);
                }
            }

            if (name.Length <= 2)
            {
                shortCount++;
                if (shortNames.Count < Examples && !shortNames.Contains(name, StringComparer.Ordinal))
                {
                    shortNames.Add(name);
                }
            }
        }

        foreach (var handle in metadata.TypeDefinitions.Skip(1))
        {
            if (IsMadeUp(metadata, handle))
            {
                continue;
            }

            var type = metadata.GetTypeDefinition(handle);
            Count(metadata.GetString(type.Name));

            var accessors = new HashSet<MethodDefinitionHandle>();
            foreach (var property in type.GetProperties().Select(metadata.GetPropertyDefinition))
            {
                var methods = property.GetAccessors();
                accessors.UnionWith(new[] { methods.Getter, methods.Setter }.Concat(methods.Others).Where(method => !method.IsNil));
                CountMember(metadata.GetString(property.Name));
            }

            foreach (var @event in type.GetEvents().Select(metadata.GetEventDefinition))
            {
                var methods = @event.GetAccessors();
                accessors.UnionWith(new[] { methods.Adder, methods.Remover, methods.Raiser }.Concat(methods.Others).Where(method => !method.IsNil));
                CountMember(metadata.GetString(@event.Name));
            }

            foreach (var methodHandle in type.GetMethods())
            {
                var method = metadata.GetMethodDefinition(methodHandle);
                if ((method.Attributes & MethodAttributes.RTSpecialName) == 0 && !accessors.Contains(methodHandle))
                {
                    CountMember(metadata.GetString(method.Name));
                }
            }

            foreach (var field in type.GetFields().Select(metadata.GetFieldDefinition))
            {
                if ((field.Attributes & FieldAttributes.RTSpecialName) == 0)
                {
                    CountMember(metadata.GetString(field.Name));
                }
            }
        }

        return new NameEvidence(count, unprintableCount, shortCount, unprintable, shortNames);

        // An explicit interface implementation is named after the interface's member, as Namespace.IFoo.Bar.
        void CountMember(string name)
        {
            if (!name.Contains('<') && !name.Contains('.'))
            {
                Count(name);
            }
        }
    }

    /// <summary>Whether the compiler made the type up, or a type it is nested in: its name holds <c>&lt;</c>, as <c>&lt;&gt;c</c> and <c>&lt;PrivateImplementationDetails&gt;</c> do.</summary>
    private static bool IsMadeUp(MetadataReader metadata, TypeDefinitionHandle handle)
    {
        // Bounded, as metadata that nests types in a cycle would otherwise never end.
        var depth = 0;
        for (var current = handle; !current.IsNil && depth++ < 64; current = metadata.GetTypeDefinition(current).GetDeclaringType())
        {
            if (metadata.GetString(metadata.GetTypeDefinition(current).Name).Contains('<'))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Whether <paramref name="name"/> holds a character no source file shows (see <see cref="NameEvidence.Unprintable"/>).</summary>
    internal static bool IsUnprintable(string name)
    {
        for (var i = 0; i < name.Length;)
        {
            if (Rune.DecodeFromUtf16(name.AsSpan(i), out var rune, out var length) != System.Buffers.OperationStatus.Done)
            {
                // A lone surrogate.
                return true;
            }

            i += length;
            switch (Rune.GetUnicodeCategory(rune))
            {
                case UnicodeCategory.Control:
                case UnicodeCategory.Format:
                case UnicodeCategory.PrivateUse:
                case UnicodeCategory.OtherNotAssigned:
                case UnicodeCategory.Surrogate:
                case UnicodeCategory.LineSeparator:
                case UnicodeCategory.ParagraphSeparator:
                    return true;
                case UnicodeCategory.SpaceSeparator when rune.Value != ' ':
                    return true;
            }
        }

        return false;
    }

    private static StringEvidence Strings(PEReader reader, MetadataReader metadata)
    {
        var literals = new Dictionary<TypeDefinitionHandle, int>();
        var calls = new List<(TypeDefinitionHandle Caller, MethodDefinitionHandle Callee)>();
        var decoding = new HashSet<TypeDefinitionHandle>();

        foreach (var handle in metadata.MethodDefinitions)
        {
            var method = metadata.GetMethodDefinition(handle);
            if (method.RelativeVirtualAddress == 0 || ScanBody(reader, metadata, method) is not { } body)
            {
                continue;
            }

            var type = method.GetDeclaringType();
            literals[type] = literals.GetValueOrDefault(type) + body.Literals;
            calls.AddRange(body.Calls.Select(callee => (type, callee)));
            if (body.DecodesText)
            {
                decoding.Add(type);
            }
        }

        var decoderCalls = 0;
        var decoderTypes = new HashSet<TypeDefinitionHandle>();
        foreach (var (caller, callee) in calls)
        {
            var declaring = metadata.GetMethodDefinition(callee).GetDeclaringType();
            if (declaring != caller && decoding.Contains(declaring) && IsStringDecoder(metadata, callee))
            {
                decoderCalls++;
                decoderTypes.Add(declaring);
            }
        }

        return new StringEvidence(
            literals.Where(entry => !decoderTypes.Contains(entry.Key)).Sum(entry => entry.Value),
            decoderCalls,
            metadata.TypeDefinitions
                .Where(decoderTypes.Contains)
                .Select(handle => TypeDefinitionName(metadata, handle))
                .ToList());
    }

    /// <summary>What a method body holds of strings: its literals, the methods of the Assembly it calls, and whether it decodes bytes into text.</summary>
    private sealed record Body(int Literals, List<MethodDefinitionHandle> Calls, bool DecodesText);

    /// <summary>
    /// Reads the method's IL, or returns null if it cannot be read: an
    /// obfuscator may encrypt a body until it runs, or fill it with what is not
    /// IL, and such a body is passed over rather than the Assembly refused.
    /// </summary>
    private static Body? ScanBody(PEReader reader, MetadataReader metadata, MethodDefinition method)
    {
        var literals = 0;
        var calls = new List<MethodDefinitionHandle>();
        var decodesText = false;
        try
        {
            var il = reader.GetMethodBody(method.RelativeVirtualAddress).GetILReader();
            while (il.RemainingBytes > 0)
            {
                var opCode = il.DecodeOpCode();
                switch (opCode)
                {
                    case ILOpCode.Ldstr:
                        il.ReadInt32();
                        literals++;
                        break;
                    case ILOpCode.Call or ILOpCode.Callvirt:
                        var token = il.ReadInt32();
                        var row = token & 0xFFFFFF;
                        switch ((uint)token >> 24)
                        {
                            case 0x06 when row >= 1 && row <= metadata.MethodDefinitions.Count:
                                calls.Add(MetadataTokens.MethodDefinitionHandle(row));
                                break;
                            case 0x0A when row >= 1 && row <= metadata.GetTableRowCount(TableIndex.MemberRef):
                                decodesText |= IsGetString(metadata, MetadataTokens.MemberReferenceHandle(row));
                                break;
                        }

                        break;
                    default:
                        ILParser.SkipOperand(ref il, opCode);
                        break;
                }
            }
        }
        catch (BadImageFormatException)
        {
            return null;
        }

        return new Body(literals, calls, decodesText);
    }

    /// <summary>Whether the method is <c>System.Text.Encoding.GetString</c>, of any overload.</summary>
    private static bool IsGetString(MetadataReader metadata, MemberReferenceHandle handle)
    {
        var member = metadata.GetMemberReference(handle);
        if (member.Parent.Kind != HandleKind.TypeReference || !metadata.StringComparer.Equals(member.Name, "GetString"))
        {
            return false;
        }

        var type = metadata.GetTypeReference((TypeReferenceHandle)member.Parent);
        return metadata.StringComparer.Equals(type.Namespace, "System.Text")
            && metadata.StringComparer.Equals(type.Name, "Encoding");
    }

    /// <summary>Whether the method is static, returns a <c>string</c>, takes nothing but integers, and is no property's accessor.</summary>
    private static bool IsStringDecoder(MetadataReader metadata, MethodDefinitionHandle handle)
    {
        var method = metadata.GetMethodDefinition(handle);
        if ((method.Attributes & MethodAttributes.Static) == 0 || IsPropertyAccessor(metadata, handle))
        {
            return false;
        }

        try
        {
            return TakesIntegersAndReturnsString(metadata.GetBlobReader(method.Signature));
        }
        catch (BadImageFormatException)
        {
            return false;
        }
    }

    private static bool TakesIntegersAndReturnsString(BlobReader signature)
    {
        if (signature.ReadSignatureHeader().IsGeneric)
        {
            signature.ReadCompressedInteger();
        }

        var parameters = signature.ReadCompressedInteger();
        if (signature.ReadSignatureTypeCode() != SignatureTypeCode.String)
        {
            return false;
        }

        for (var i = 0; i < parameters; i++)
        {
            if (signature.ReadSignatureTypeCode() is not (
                SignatureTypeCode.SByte or SignatureTypeCode.Byte
                or SignatureTypeCode.Int16 or SignatureTypeCode.UInt16
                or SignatureTypeCode.Int32 or SignatureTypeCode.UInt32
                or SignatureTypeCode.Int64 or SignatureTypeCode.UInt64))
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsPropertyAccessor(MetadataReader metadata, MethodDefinitionHandle handle) =>
        metadata.GetTypeDefinition(metadata.GetMethodDefinition(handle).GetDeclaringType())
            .GetProperties()
            .Select(property => metadata.GetPropertyDefinition(property).GetAccessors())
            .Any(accessors => accessors.Getter == handle || accessors.Setter == handle);
}
