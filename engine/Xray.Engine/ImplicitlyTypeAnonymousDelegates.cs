using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Declares with <c>var</c> each local whose type is an anonymous delegate:
/// one the compiler makes up for a lambda's natural type when no Func or
/// Action fits, as for <c>var scale = (int value, int by = 3) =&gt; value * by</c>.
/// The decompiler writes the made-up type out, but C# cannot always declare
/// it: here, its <c>T2 arg2 = 3</c> is a default no type parameter can have
/// (CS1750). Declared with <c>var</c>, the local is given the same type again
/// by the compiler, so <see cref="AssemblyDecompiler"/> can leave out such a
/// delegate's own declaration.
/// </summary>
internal sealed class ImplicitlyTypeAnonymousDelegates : IAstTransform
{
    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var declaration in rootNode.Descendants.OfType<VariableDeclarationStatement>().ToList())
        {
            if (declaration.Variables.Count == 1
                && declaration.Variables.Single().Initializer is LambdaExpression or AnonymousMethodExpression
                && declaration.Type.GetResolveResult().Type.GetDefinition() is { } type
                && IsAnonymousDelegate(type))
            {
                declaration.Type = new SimpleType("var");
            }
        }
    }

    /// <summary>
    /// Whether a type is a delegate the compiler made up for a lambda's natural
    /// type: <c>&lt;&gt;f__AnonymousDelegate0</c>, or, for one taking a parameter by
    /// <c>ref</c>, <c>&lt;&gt;A{00000001}`1</c> or <c>&lt;&gt;F{00000001}`2</c>.
    /// </summary>
    public static bool IsAnonymousDelegate(ITypeDefinition type) =>
        type.Kind == TypeKind.Delegate
        && type.DeclaringTypeDefinition is null
        && type.Namespace.Length == 0
        && (type.Name.StartsWith("<>f__AnonymousDelegate", StringComparison.Ordinal)
            || type.Name.StartsWith("<>A", StringComparison.Ordinal)
            || type.Name.StartsWith("<>F", StringComparison.Ordinal))
        && type.HasAttribute(KnownAttribute.CompilerGenerated);

    /// <summary>
    /// Whether C# cannot declare an anonymous delegate: one of its parameters is
    /// of a type parameter's type, with a default other than <c>null</c>, which
    /// only the compiler can give it (CS1750).
    /// </summary>
    public static bool IsUndeclarable(ITypeDefinition type) =>
        IsAnonymousDelegate(type)
        && type.GetDelegateInvokeMethod() is { } invoke
        && invoke.Parameters.Any(parameter =>
            parameter.Type.Kind == TypeKind.TypeParameter
            && parameter.HasConstantValueInSignature
            && parameter.GetConstantValue() is not null);
}
