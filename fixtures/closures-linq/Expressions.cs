using System;
using System.Linq;
using System.Linq.Expressions;

namespace ClosuresLinq;

/// <summary>
/// Lambdas converted to expression trees rather than delegates: the compiler
/// builds the tree with calls to <c>Expression</c>, which must come back as a
/// lambda, or the tree would print and behave differently.
/// </summary>
internal static class Expressions
{
    public static string[] Describe(int left, int right)
    {
        Expression<Func<int, int, int>> combine = (a, b) => a * b + (a - b) % 3;
        Expression<Func<string, bool>> isShort = text => text.Length < 4 && !text.StartsWith("x");
        Expression<Func<int, string>> sign = value => value > 0 ? "positive" : value < 0 ? "negative" : "zero";
        var threshold = left;
        Expression<Func<int, bool>> above = value => value > threshold;
        var compiled = above.Compile();
        threshold = right;

        return
        [
            $"{combine} gives {combine.Compile()(left, right)}",
            $"{isShort}: {isShort.Compile()($"{left}")}, {isShort.Compile()("xy")}",
            $"{sign}: {sign.Compile()(left - right)}",
            $"above's body is a {above.Body.NodeType}; {right} is above the threshold now: {compiled(right)}, {left + 1} is: {compiled(left + 1)}",
            $"a query over expressions: [{string.Join(", ", new[] { left, right, left + right }.AsQueryable().Where(value => value % 2 == 0).Select(value => value / 2))}]",
        ];
    }
}
