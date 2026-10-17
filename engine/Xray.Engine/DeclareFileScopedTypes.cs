using System.Text.RegularExpressions;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.OutputVisitor;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Declares each file-scoped type (C# 11) as one again: <c>file static class
/// Format</c>, referred to as <c>Format</c>. The compiler names it after the
/// file it was declared in, a checksum of that file's path and its own name,
/// <c>&lt;Greetings&gt;F1A2B…__Format</c>, so that two files can each have a
/// <c>Format</c>; the decompiler writes it as an ordinary type of that name,
/// visible outside its file. A file-scoped type is visible only in its own
/// file, so <see cref="AssemblyDecompiler"/> declares it in the same unit as
/// the types that use it. Runs before names are escaped.
/// </summary>
internal sealed partial class DeclareFileScopedTypes : IAstTransform
{
    /// <summary>Marks a declaration <see cref="OutputVisitor"/> writes with <c>file</c>.</summary>
    private sealed class FileScoped
    {
        public static readonly FileScoped Instance = new();
    }

    /// <summary>
    /// The file a file-scoped type was declared in: the start of the type's
    /// name, which tells it from every other file, <c>&lt;Greetings&gt;F1A2B…</c>,
    /// and the file's name without its extension, <c>Greetings</c>.
    /// </summary>
    public sealed record SourceFile(string Prefix, string Name);

    // <File>F, the SHA-256 of the file's path in hex, __, then the type's own name.
    [GeneratedRegex("^(?<prefix><(?<file>[^>]*)>F[0-9A-F]{64})__(?<name>.+)$")]
    private static partial Regex FileScopedName();

    /// <summary>The file a top-level file-scoped type was declared in; null for any other type.</summary>
    public static SourceFile? FileOf(ITypeDefinition type) =>
        type.DeclaringTypeDefinition is null && FileScopedName().Match(type.Name) is { Success: true } match
            ? new SourceFile(match.Groups["prefix"].Value, match.Groups["file"].Value)
            : null;

    /// <summary>The files whose file-scoped types a decompiled unit uses.</summary>
    public static IEnumerable<SourceFile> FilesUsedBy(AstNode unit) =>
        unit.DescendantsAndSelf
            .SelectMany(node => new[]
            {
                node.GetSymbol() switch
                {
                    ITypeDefinition type => type,
                    IEntity member => member.DeclaringTypeDefinition,
                    IType type => type.GetDefinition(),
                    _ => null,
                },
                node.GetResolveResult().Type.GetDefinition(),
            })
            .Select(type => TopLevel(type) is { } topLevel ? FileOf(topLevel) : null)
            .OfType<SourceFile>()
            .Distinct();

    private static ITypeDefinition? TopLevel(ITypeDefinition? type)
    {
        while (type?.DeclaringTypeDefinition is { } declaring)
        {
            type = declaring;
        }

        return type;
    }

    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var node in rootNode.Descendants)
        {
            switch (node)
            {
                case EntityDeclaration declaration and (TypeDeclaration or DelegateDeclaration)
                    when declaration.GetSymbol() is ITypeDefinition type && OwnName(type) is { } name:
                    declaration.Name = name;
                    // Its metadata makes it internal, which C# does not let it say (CS9052).
                    declaration.Modifiers &= ~Modifiers.VisibilityMask;
                    declaration.AddAnnotation(FileScoped.Instance);
                    break;
                case SimpleType reference when OwnName(reference.GetResolveResult().Type.GetDefinition()) is { } name:
                    reference.Identifier = name;
                    break;
                case MemberType reference when OwnName(reference.GetResolveResult().Type.GetDefinition()) is { } name:
                    reference.MemberName = name;
                    break;
            }
        }
    }

    /// <summary>A file-scoped type's own name, <c>Format</c>; null for any other type.</summary>
    private static string? OwnName(ITypeDefinition? type) =>
        type is not null && FileOf(type) is { } file ? type.Name[(file.Prefix.Length + "__".Length)..] : null;

    /// <summary>
    /// Writes C#, with <c>file</c> before each declaration marked file-scoped,
    /// and a blank line between the types and namespaces a file declares,
    /// which the decompiler's own writer runs together.
    /// </summary>
    internal sealed class OutputVisitor(TextWriter writer, CSharpFormattingOptions options) : CSharpOutputVisitor(writer, options)
    {
        private bool fileScoped;

        public override void VisitTypeDeclaration(TypeDeclaration typeDeclaration)
        {
            SeparateFromPreviousDeclaration(typeDeclaration);
            fileScoped = typeDeclaration.Annotation<FileScoped>() is not null;
            base.VisitTypeDeclaration(typeDeclaration);
        }

        public override void VisitDelegateDeclaration(DelegateDeclaration delegateDeclaration)
        {
            SeparateFromPreviousDeclaration(delegateDeclaration);
            fileScoped = delegateDeclaration.Annotation<FileScoped>() is not null;
            base.VisitDelegateDeclaration(delegateDeclaration);
        }

        public override void VisitNamespaceDeclaration(NamespaceDeclaration namespaceDeclaration)
        {
            SeparateFromPreviousDeclaration(namespaceDeclaration);
            base.VisitNamespaceDeclaration(namespaceDeclaration);
        }

        /// <summary>
        /// A blank line before a declaration in a file or a namespace that
        /// follows another; members of a type are spaced by the options.
        /// </summary>
        private void SeparateFromPreviousDeclaration(AstNode declaration)
        {
            if (declaration.Parent is SyntaxTree or NamespaceDeclaration
                && declaration.PrevSibling is TypeDeclaration or DelegateDeclaration or NamespaceDeclaration)
            {
                NewLine();
            }
        }

        // A declaration's attributes are written before its modifiers, and
        // declare none of their own, so the first modifiers written after a
        // declaration starts are its own.
        protected override void WriteModifiers(Modifiers modifiers)
        {
            if (fileScoped)
            {
                fileScoped = false;
                WriteKeyword("file");
                Space();
            }

            base.WriteModifiers(modifiers);
        }
    }
}
