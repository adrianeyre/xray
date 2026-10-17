using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Writes a copy of a record made with an empty <c>with</c> expression,
/// <c>tagged with { }</c>, as it was. The compiler makes it a call to the
/// record's <c>&lt;Clone&gt;$</c> method, as for any <c>with</c> expression;
/// the decompiler turns those back into <c>with</c> expressions when they
/// set something, but leaves an empty one the call, which C# cannot make.
/// </summary>
internal sealed class WriteClonesAsWith : IAstTransform
{
    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var invocation in rootNode.Descendants.OfType<InvocationExpression>().ToList())
        {
            if (invocation.Arguments.Count == 0
                && invocation.GetSymbol() is IMethod { Name: "<Clone>$", IsStatic: false, Parameters.Count: 0 })
            {
                // record.<Clone>$(), or <Clone>$() inside the record itself.
                var original = invocation.Target is MemberReferenceExpression clone
                    ? clone.Target.Detach()
                    : new ThisReferenceExpression();
                var copy = new WithInitializerExpression(original, new ArrayInitializerExpression());
                copy.CopyAnnotationsFrom(invocation);
                invocation.ReplaceWith(copy);
            }
        }
    }
}
