using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using ICSharpCode.BamlDecompiler;
using ICSharpCode.Decompiler.Disassembler;
using ICSharpCode.Decompiler.Metadata;
using ICSharpCode.Decompiler.TypeSystem;
using ICSharpCode.Decompiler.Util;

namespace Xray.Engine;

/// <summary>A XAML document, decompiled from the BAML the markup compiler built of it.</summary>
/// <param name="Entry">
/// Its entry in the WPF resources, which the markup compiler names after the
/// XAML file's path in its project, lowercased: <c>views/mainwindow.baml</c>.
/// </param>
/// <param name="Class">
/// The type its <c>x:Class</c> names, e.g. <c>App.MainWindow</c>, whose
/// code-behind the markup compiler completed; null if it names none, as a
/// <c>ResourceDictionary</c> of its own does not.
/// </param>
/// <param name="ApplicationDefinition">
/// Whether it is the app's <c>ApplicationDefinition</c>: its class is an
/// <c>Application</c>, and the markup compiler generated the Assembly's entry
/// point, its <c>Main</c>, from it.
/// </param>
/// <param name="Code">The XAML, lines ending in "\n".</param>
internal sealed record DecompiledXaml(string Entry, string? Class, bool ApplicationDefinition, string Code);

/// <summary>
/// The XAML of an Assembly's WPF resources, decompiled from their BAML, and the
/// members the markup compiler generated of the classes it names.
/// </summary>
/// <param name="Resource">The logical name of the WPF resources: <c>&lt;Assembly&gt;.g.resources</c>.</param>
/// <param name="Documents">
/// Each of its BAML entries, decompiled, in the order the resources hold them;
/// none if any could not be.
/// </param>
/// <param name="NotDecompiled">Why none was, if one could not be decompiled; otherwise null.</param>
/// <param name="Generated">
/// Of each class a document names, the members the markup compiler generated
/// (its named elements' fields, <c>InitializeComponent</c>, the
/// <c>Connect</c> methods hooking its events, and an app's <c>Main</c>),
/// which it generates again from the XAML; none if the BAML was not decompiled.
/// </param>
internal sealed record WpfXaml(
    string Resource,
    IReadOnlyList<DecompiledXaml> Documents,
    string? NotDecompiled,
    IReadOnlyDictionary<TypeDefinitionHandle, IReadOnlySet<EntityHandle>> Generated);

/// <summary>
/// Decompiles the BAML in an Assembly's WPF resources to XAML, with ILSpy's
/// BAML decompiler, which needs WPF's own assemblies to tell the types and
/// properties it names. Where its XAML goes, and the project around it, is
/// core's business.
/// </summary>
internal static class WpfXamlReader
{
    private const string BamlExtension = ".baml";

    // An implementation assembly, which a type resolved on the runtime the
    // engine runs on is in, but no project references; mscorlib forwards to it,
    // and every framework's reference assemblies have that.
    private const string ImplementationCoreLibrary = "System.Private.CoreLib";
    private const string ReferenceCoreLibrary = "mscorlib";

    /// <summary>
    /// The XAML of the Assembly's WPF resources, <c>&lt;Assembly&gt;.g.resources</c>,
    /// where the markup compiler put its BAML; null if it has none, or no BAML
    /// in them. All or nothing: should one document fail, none is given, and
    /// the classes keep every member, so the BAML, kept as it is, still works
    /// with them.
    /// </summary>
    public static WpfXaml? Read(PEFile file, IAssemblyResolver resolver)
    {
        var metadata = file.Metadata;
        var name = $"{metadata.GetString(metadata.GetAssemblyDefinition().Name)}.g.resources";
        var resource = file.Resources.FirstOrDefault(candidate => candidate.ResourceType == ResourceType.Embedded && candidate.Name == name);
        if (resource?.TryOpenStream() is not { } stream)
        {
            return null;
        }

        List<(string Entry, Stream Baml)> bamls;
        try
        {
            using var resources = new ResourcesFile(stream);
            bamls = [
                .. resources
                    .Where(entry => entry.Key.EndsWith(BamlExtension, StringComparison.OrdinalIgnoreCase))
                    .Select(entry => (entry.Key, entry.Value switch
                    {
                        Stream baml => baml,
                        byte[] bytes => new MemoryStream(bytes, writable: false),
                        _ => Stream.Null,
                    })),
            ];
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            return new WpfXaml(name, [], $"Its resources could not be read: {exception.Message}", new Dictionary<TypeDefinitionHandle, IReadOnlySet<EntityHandle>>());
        }

        if (bamls.Count == 0)
        {
            return null;
        }

        var typeSystem = new BamlDecompilerTypeSystem(file, resolver);
        var settings = new BamlDecompilerSettings { ThrowOnAssemblyResolveErrors = false };
        var entryPoint = file.Reader.PEHeaders.CorHeader?.EntryPointTokenOrRelativeVirtualAddress ?? 0;
        var documents = new List<DecompiledXaml>();
        var generated = new Dictionary<TypeDefinitionHandle, IReadOnlySet<EntityHandle>>();
        foreach (var (entry, baml) in bamls)
        {
            BamlDecompilationResult result;
            try
            {
                result = new XamlDecompiler(typeSystem, settings).Decompile(baml);
            }
            catch (Exception exception) when (exception is not OutOfMemoryException)
            {
                return new WpfXaml(name, [], $"Its entry \"{entry}\" could not be decompiled: {exception.Message}", new Dictionary<TypeDefinitionHandle, IReadOnlySet<EntityHandle>>());
            }

            var type = result.TypeName is { } typeName ? typeSystem.MainModule.GetTypeDefinition(typeName.TopLevelTypeName) : null;
            var members = result.GeneratedMembers.ToHashSet();
            // What else the markup compiler generated, and generates again,
            // such as the _CreateDelegate it adds for an EventSetter's handler.
            foreach (var method in type?.Methods.Where(IsGenerated) ?? [])
            {
                members.Add(method.MetadataToken);
            }

            var applicationDefinition = false;
            if (type is not null && !type.MetadataToken.IsNil)
            {
                var handle = (TypeDefinitionHandle)type.MetadataToken;
                generated[handle] = generated.TryGetValue(handle, out var others) ? others.Concat(members).ToHashSet() : members;
                if (IsApplication(type))
                {
                    applicationDefinition = entryPoint != 0 && members.Contains(MetadataTokens.EntityHandle(entryPoint));
                    HookEventsOf(result.Xaml, file, type, members);
                }
            }

            UseReferenceCoreLibrary(result.Xaml);
            TidyNamespaceDeclarations(result.Xaml);
            documents.Add(new DecompiledXaml(entry, type?.ReflectionName ?? result.TypeName?.ReflectionName, applicationDefinition, Write(result.Xaml)));
        }

        return new WpfXaml(name, documents, null, generated);
    }

    /// <summary>Whether the markup compiler generated a method, as its <c>[GeneratedCode("PresentationBuildTasks", …)]</c> says.</summary>
    private static bool IsGenerated(IMethod method) =>
        !method.MetadataToken.IsNil
        && method.GetAttributes().Any(attribute =>
            attribute.AttributeType.FullName == "System.CodeDom.Compiler.GeneratedCodeAttribute"
            && attribute.FixedArguments.FirstOrDefault().Value is "PresentationBuildTasks");

    private static bool IsApplication(ITypeDefinition type) =>
        type.GetNonInterfaceBaseTypes().Any(baseType => baseType.FullName == "System.Windows.Application");

    /// <summary>
    /// Sets on the document's root the events of the app that its
    /// <c>InitializeComponent</c>, which the markup compiler generated, hooks:
    /// an <c>Application</c>'s own events, such as <c>Startup="App_Startup"</c>,
    /// are hooked there, not in its BAML, where BAML hooks those of the
    /// elements it builds; so a document decompiled without them would build
    /// into an app whose handlers never run.
    /// </summary>
    private static void HookEventsOf(XDocument xaml, PEFile file, ITypeDefinition type, IReadOnlySet<EntityHandle> generated)
    {
        if (xaml.Root is not { } root)
        {
            return;
        }

        var initializeComponent = type.Methods.FirstOrDefault(method =>
            method.Name == "InitializeComponent"
            && method.Parameters.Count == 0
            && !method.MetadataToken.IsNil
            && generated.Contains(method.MetadataToken));
        if (initializeComponent is null)
        {
            return;
        }

        foreach (var (eventName, handler) in EventsHookedIn(file, (MethodDefinitionHandle)initializeComponent.MetadataToken))
        {
            if (root.Attribute(eventName) is null)
            {
                root.Add(new XAttribute(eventName, handler));
            }
        }
    }

    /// <summary>
    /// The events a generated method hooks, and their handlers, of its own
    /// type, as the markup compiler writes each:
    /// <c>this.Startup += new StartupEventHandler(this.App_Startup);</c>, that
    /// is, <c>ldftn App_Startup</c>, then the delegate's <c>newobj</c>, then a
    /// call to <c>add_Startup</c>.
    /// </summary>
    private static IEnumerable<(string Event, string Handler)> EventsHookedIn(PEFile file, MethodDefinitionHandle method)
    {
        var metadata = file.Metadata;
        var definition = metadata.GetMethodDefinition(method);
        if (definition.RelativeVirtualAddress == 0)
        {
            return [];
        }

        var hooked = new List<(string Event, string Handler)>();
        try
        {
            var reader = file.GetMethodBody(definition.RelativeVirtualAddress).GetILReader();
            string? handler = null;
            while (reader.RemainingBytes > 0)
            {
                var opCode = reader.DecodeOpCode();
                switch (opCode)
                {
                    case ILOpCode.Ldftn:
                        var target = MetadataTokens.EntityHandle(reader.ReadInt32());
                        handler = target.Kind == HandleKind.MethodDefinition
                            ? metadata.GetString(metadata.GetMethodDefinition((MethodDefinitionHandle)target).Name)
                            : null;
                        break;
                    case ILOpCode.Newobj:
                        // The delegate, made of the handler.
                        reader.ReadInt32();
                        break;
                    case ILOpCode.Call:
                    case ILOpCode.Callvirt:
                        var callee = NameOf(metadata, MetadataTokens.EntityHandle(reader.ReadInt32()));
                        if (handler is not null && callee is not null && callee.StartsWith("add_", StringComparison.Ordinal))
                        {
                            hooked.Add((callee["add_".Length..], handler));
                        }

                        handler = null;
                        break;
                    default:
                        ILParser.SkipOperand(ref reader, opCode);
                        break;
                }
            }
        }
        catch (BadImageFormatException)
        {
            // A body that cannot be read hooks nothing that can be told.
        }

        return hooked;
    }

    private static string? NameOf(MetadataReader metadata, EntityHandle method) =>
        method.Kind switch
        {
            HandleKind.MethodDefinition => metadata.GetString(metadata.GetMethodDefinition((MethodDefinitionHandle)method).Name),
            HandleKind.MemberReference => metadata.GetString(metadata.GetMemberReference((MemberReferenceHandle)method).Name),
            _ => null,
        };

    /// <summary>
    /// Names <c>mscorlib</c> where the decompiler names
    /// <c>System.Private.CoreLib</c> as the assembly of a CLR namespace
    /// (<c>xmlns:system="clr-namespace:System;assembly=System.Private.CoreLib"</c>,
    /// for a <c>sys:Double</c>): it is where the runtime the engine runs on
    /// keeps <c>System.Double</c>, but no project references it, so the markup
    /// compiler would find no such type.
    /// </summary>
    private static void UseReferenceCoreLibrary(XDocument xaml)
    {
        var renamed = new Dictionary<XNamespace, XNamespace>();
        foreach (var element in xaml.Descendants())
        {
            foreach (var attribute in element.Attributes().Where(attribute => attribute.IsNamespaceDeclaration).ToList())
            {
                var reference = ReferencedCoreLibrary(attribute.Value);
                if (reference is not null)
                {
                    renamed[attribute.Value] = reference;
                    attribute.Value = reference;
                }
            }
        }

        if (renamed.Count == 0)
        {
            return;
        }

        foreach (var element in xaml.Descendants())
        {
            if (renamed.TryGetValue(element.Name.Namespace, out var elementNamespace))
            {
                element.Name = elementNamespace + element.Name.LocalName;
            }

            foreach (var attribute in element.Attributes().Where(attribute => !attribute.IsNamespaceDeclaration && renamed.ContainsKey(attribute.Name.Namespace)).ToList())
            {
                attribute.Remove();
                element.Add(new XAttribute(renamed[attribute.Name.Namespace] + attribute.Name.LocalName, attribute.Value));
            }
        }
    }

    /// <summary>
    /// Writes each element's attributes as Visual Studio does, <c>x:Class</c>
    /// first, then its namespace declarations, then the rest, in their order;
    /// and leaves out a declaration of a namespace that one in scope already
    /// declares by another prefix, which no markup extension names (as
    /// <c>{x:Type system:Double}</c> would), as the decompiler declares the
    /// namespace of a core type again where its BAML names it. So the BAML the
    /// markup compiler builds of the XAML decompiles to that XAML again.
    /// </summary>
    private static void TidyNamespaceDeclarations(XDocument xaml)
    {
        var xClass = XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml") + "Class";
        foreach (var element in xaml.Descendants().ToList())
        {
            var inScope = element.Ancestors()
                .SelectMany(ancestor => ancestor.Attributes())
                .Where(attribute => attribute.IsNamespaceDeclaration)
                .Select(attribute => attribute.Value)
                .ToHashSet();
            var attributes = element.Attributes().ToList();
            var kept = new List<XAttribute>();
            foreach (var attribute in attributes)
            {
                if (attribute.IsNamespaceDeclaration
                    && attribute.Name.Namespace == XNamespace.Xmlns
                    && !inScope.Add(attribute.Value)
                    && !NamesPrefix(element, attribute.Name.LocalName))
                {
                    continue;
                }

                kept.Add(attribute);
            }

            element.ReplaceAttributes(kept.OrderBy(attribute => attribute.Name == xClass ? 0 : attribute.IsNamespaceDeclaration ? 1 : 2).ToList());
        }
    }

    /// <summary>Whether a value or text within an element names a prefix, as a markup extension does: <c>{x:Static system:Math.PI}</c>.</summary>
    private static bool NamesPrefix(XElement element, string prefix)
    {
        var named = new Regex($@"(?<![\w.]){Regex.Escape(prefix)}:");
        return element.DescendantsAndSelf().Any(within =>
            within.Attributes().Any(attribute => !attribute.IsNamespaceDeclaration && named.IsMatch(attribute.Value))
            || within.Nodes().OfType<XText>().Any(text => named.IsMatch(text.Value)));
    }

    private static string? ReferencedCoreLibrary(string xmlNamespace)
    {
        var suffix = $";assembly={ImplementationCoreLibrary}";
        return xmlNamespace.StartsWith("clr-namespace:", StringComparison.Ordinal) && xmlNamespace.EndsWith(suffix, StringComparison.Ordinal)
            ? $"{xmlNamespace[..^suffix.Length]};assembly={ReferenceCoreLibrary}"
            : null;
    }

    /// <summary>The XAML as Visual Studio indents it, without an XML declaration; lines end in "\n" on every OS.</summary>
    private static string Write(XDocument xaml)
    {
        using var writer = new StringWriter { NewLine = "\n" };
        using (var xml = XmlWriter.Create(writer, new XmlWriterSettings
        {
            Indent = true,
            IndentChars = "    ",
            NewLineChars = "\n",
            NewLineHandling = NewLineHandling.Replace,
            OmitXmlDeclaration = true,
        }))
        {
            xaml.Save(xml);
        }

        return writer + "\n";
    }
}
