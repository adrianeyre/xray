using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.Semantics;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Throws where the decompiled code calls a helper the compiler added to
/// <c>&lt;PrivateImplementationDetails&gt;</c> to throw for it, which no source
/// can call: a switch expression that matches nothing calls
/// <c>ThrowSwitchExpressionException(value)</c>, written back as
/// <c>throw new SwitchExpressionException(value)</c>, the exception the helper
/// throws. The statements after it in its block, which can no longer run, are
/// left out.
/// </summary>
internal sealed class InlineThrowHelpers : IAstTransform
{
    private static readonly FullTypeName SwitchExpressionException = new("System.Runtime.CompilerServices.SwitchExpressionException");

    /// <summary>What each helper throws, given the arguments it is called with.</summary>
    private static readonly Dictionary<string, FullTypeName> Thrown = new()
    {
        ["ThrowSwitchExpressionException"] = SwitchExpressionException,
        ["ThrowSwitchExpressionExceptionNoArg"] = SwitchExpressionException,
        // Where SwitchExpressionException is not available, as on .NET Framework.
        ["ThrowInvalidOperationException"] = new("System.InvalidOperationException"),
    };

    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var statement in rootNode.Descendants.OfType<ExpressionStatement>().ToList())
        {
            if (statement.Expression is not InvocationExpression invocation
                || invocation.GetSymbol() is not IMethod { IsStatic: true, DeclaringTypeDefinition.ReflectionName: "<PrivateImplementationDetails>" } helper
                || !Thrown.TryGetValue(helper.Name, out var thrownName)
                || context.TypeSystem.FindType(thrownName) is not { Kind: not TypeKind.Unknown } thrown)
            {
                continue;
            }

            var exception = new ObjectCreateExpression(
                context.TypeSystemAstBuilder.ConvertType(thrown),
                invocation.Arguments.Select(argument => argument.Detach()));
            exception.AddAnnotation(new ResolveResult(thrown));
            var replacement = new ThrowStatement(exception);
            statement.ReplaceWith(replacement);
            RemoveUnreachable(replacement);
        }
    }

    /// <summary>
    /// Removes the statements after a throw in its block, up to a label that
    /// a goto could reach; a local function stays, as code before it may call it.
    /// </summary>
    private static void RemoveUnreachable(Statement thrown)
    {
        for (var next = thrown.GetNextStatement(); next is not null and not LabelStatement;)
        {
            var following = next.GetNextStatement();
            if (next is not LocalFunctionDeclarationStatement)
            {
                next.Remove();
            }

            next = following;
        }
    }
}
