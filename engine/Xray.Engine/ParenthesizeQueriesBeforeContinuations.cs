using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;

namespace Xray.Engine;

/// <summary>
/// Parenthesizes a query that ends the clause a query continuation follows:
/// <c>parts.Select(g =&gt; g.Select(t =&gt; Parse(t))).Where(g =&gt; !g.Contains(null))</c>,
/// which the decompiler writes as
/// <c>from g in parts select from t in g select Parse(t) into g where !g.Contains(null)</c>.
/// A query has no token to end it, so C# reads the <c>into g</c> as the inner
/// query's, whose range variable then conflicts with the outer <c>g</c>
/// (CS1931), and the <c>where</c> as reading a result of <c>Parse</c> (CS1061).
/// Parenthesized, <c>select (from t in g select Parse(t)) into g</c>, the
/// continuation is the outer query's, as the method calls were; reusing the
/// outer range variable's name for it is then no conflict, as its scope ends
/// where the continuation begins.
/// </summary>
internal sealed class ParenthesizeQueriesBeforeContinuations : IAstTransform
{
    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var continuation in rootNode.Descendants.OfType<QueryContinuationClause>().ToList())
        {
            var last = continuation.PrecedingQuery.Clauses.LastOrDefault();
            var expression = last switch
            {
                QuerySelectClause select => select.Expression,
                QueryGroupClause group => group.Key,
                _ => null,
            };
            if (expression is not null && EndsInQuery(expression))
            {
                expression.ReplaceWith(ended => new ParenthesizedExpression((Expression)ended));
            }
        }
    }

    /// <summary>
    /// Whether an expression ends in a query that nothing closes, which would
    /// take a continuation after it as its own: the query itself, or the last
    /// operand of an operator, a cast or a lambda's body.
    /// </summary>
    private static bool EndsInQuery(AstNode? expression) => expression switch
    {
        QueryExpression => true,
        BinaryOperatorExpression binary => EndsInQuery(binary.Right),
        ConditionalExpression conditional => EndsInQuery(conditional.FalseExpression),
        CastExpression cast => EndsInQuery(cast.Expression),
        LambdaExpression lambda => EndsInQuery(lambda.Body),
        _ => false,
    };
}
