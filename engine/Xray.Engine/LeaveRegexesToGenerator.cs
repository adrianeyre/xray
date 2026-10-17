using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Declares each <c>[GeneratedRegex]</c> method as the developer wrote it,
/// <c>private static partial Regex Identifier();</c>, in a type declared
/// <c>partial</c>, as is every type it is nested in, and leaves out what the
/// regex source generator wrote of it, which the generator writes again from
/// that declaration: the method's body, its <c>[GeneratedCode]</c>, and any
/// other member or nested type it marks <c>[GeneratedCode]</c>. The types it
/// writes beside it (<c>file sealed class Identifier_0 : Regex</c>,
/// <c>file static class Utilities</c>) <see cref="AssemblyDecompiler"/> leaves
/// out by <see cref="IsWrittenByGenerator"/>. Declared with its body, the
/// method is one the generator refuses (SYSLIB1043); declared without the
/// attribute, it would no longer be the generator's.
/// </summary>
internal sealed class LeaveRegexesToGenerator : IAstTransform
{
    /// <summary>The tool name the generator gives its <c>[GeneratedCode]</c>.</summary>
    private const string Generator = "System.Text.RegularExpressions.Generator";

    private const string GeneratedCodeAttribute = "System.CodeDom.Compiler.GeneratedCodeAttribute";

    private const string GeneratedRegexAttribute = "System.Text.RegularExpressions.GeneratedRegexAttribute";

    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var declaration in rootNode.Descendants.OfType<EntityDeclaration>().ToList())
        {
            if (declaration.GetSymbol() is not IEntity entity || !IsWrittenByGenerator(entity))
            {
                continue;
            }

            if (!IsGeneratedRegex(entity))
            {
                declaration.Remove();
                continue;
            }

            // A [GeneratedRegex] property, partial since C# 13, is left as it
            // is: the C# a Recovered Solution is written in has none.
            if (declaration is not MethodDeclaration method)
            {
                continue;
            }

            foreach (var attribute in method.Attributes.SelectMany(section => section.Attributes).ToList())
            {
                if (attribute.Type.GetSymbol() is IType { FullName: GeneratedCodeAttribute })
                {
                    var section = (AttributeSection)attribute.Parent!;
                    attribute.Remove();
                    if (section.Attributes.Count == 0)
                    {
                        section.Remove();
                    }
                }
            }

            method.Body = null;
            method.Modifiers |= Modifiers.Partial;
            foreach (var type in method.Ancestors.OfType<TypeDeclaration>())
            {
                type.Modifiers |= Modifiers.Partial;
            }
        }
    }

    /// <summary>
    /// Whether the regex source generator wrote a type or member, as the
    /// <c>[GeneratedCode("System.Text.RegularExpressions.Generator", …)]</c>
    /// it marks each with says.
    /// </summary>
    public static bool IsWrittenByGenerator(IEntity entity) =>
        entity.GetAttributes().Any(attribute =>
            attribute.AttributeType.FullName == GeneratedCodeAttribute
            && attribute.FixedArguments is [{ Value: Generator }, ..]);

    /// <summary>Whether a method is declared <c>[GeneratedRegex]</c>, for the generator to implement.</summary>
    private static bool IsGeneratedRegex(IEntity method) =>
        method.GetAttributes().Any(attribute => attribute.AttributeType.FullName == GeneratedRegexAttribute);
}
