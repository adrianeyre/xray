using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Puts a throw expression back into the field initializer it came from,
/// such as a primary constructor's
/// <c>private readonly double kelvin = celsius &lt; -273.15 ? throw … : celsius + 273.15;</c>.
/// A constructor runs its field initializers before it calls the base
/// constructor, and the decompiler makes each one a field initializer again,
/// but only if it is a single assignment. The compiler compiles this one to
/// <c>if (celsius &lt; -273.15) throw …; kelvin = celsius + 273.15;</c>, so it
/// would be left in the constructor's body, before a call to
/// <c>base..ctor()</c> that C# cannot make. Before that call, then, each
/// <c>if (condition) throw …;</c> is merged into the assignment after it:
/// <c>kelvin = condition ? throw … : value;</c>. Runs before the decompiler
/// moves field initializers.
/// </summary>
internal sealed class MergeThrowsIntoInitializers : IAstTransform
{
    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var constructor in rootNode.Descendants.OfType<ConstructorDeclaration>())
        {
            var statements = constructor.Body?.Statements.ToList() ?? [];
            var call = statements.FindIndex(IsConstructorCall);
            // Merged from the last, so a run of checks before one assignment nests.
            for (var i = call - 2; i >= 0; i--)
            {
                if (statements[i] is IfElseStatement { FalseStatement: null } check
                    && Thrown(check.TrueStatement) is { } thrown
                    && statements[i + 1] is ExpressionStatement { Expression: AssignmentExpression { Operator: AssignmentOperatorType.Assign } assignment })
                {
                    assignment.Right = new ConditionalExpression(
                        check.Condition.Detach(),
                        new ThrowExpression(thrown.Expression!.Detach()),
                        assignment.Right.Detach());
                    check.Remove();
                    statements.RemoveAt(i);
                }
            }
        }
    }

    /// <summary>Whether a statement calls a base or other constructor of the same object, <c>base..ctor(…)</c>.</summary>
    private static bool IsConstructorCall(Statement statement) =>
        statement is ExpressionStatement { Expression: InvocationExpression { Target: MemberReferenceExpression { Target: BaseReferenceExpression or ThisReferenceExpression } } call }
        && call.GetSymbol() is IMethod { IsConstructor: true };

    private static ThrowStatement? Thrown(Statement statement) => statement switch
    {
        ThrowStatement { Expression: not null } thrown => thrown,
        BlockStatement { Statements.Count: 1 } block => Thrown(block.Statements.Single()),
        _ => null,
    };
}
