// Queries for AssemblyDecompilerTests, which the decompiler writes with query continuations.

namespace Xray.Engine.Tests.Subjects;

public static class Continuations
{
    /// <summary>As BundlerMinifier's Minimatcher does: a query in the select clause a continuation follows.</summary>
    public static List<IEnumerable<int>> Nested(string[][] parts) =>
        parts.Select(g => g.Select(t => Parse(t)))
            .Where(g => !g.Contains(null))
            .Select(g => g.Select(t => t!.Item1))
            .ToList();

    /// <summary>A query, with a continuation of its own, in the select clause one follows.</summary>
    public static IEnumerable<int> Chained(string[][] parts) =>
        parts.Select(g => g.Select(t => t.Length).Select(n => n + 1))
            .Select(g => g.Sum());

    /// <summary>A query as the key of the group clause a continuation follows.</summary>
    public static IEnumerable<int> Keyed(string[][] parts) =>
        parts.GroupBy(g => g.Select(t => t.Length))
            .Where(g => g.Any())
            .Select(g => g.Count());

    /// <summary>A query as what a group clause groups, which its key ends.</summary>
    public static IEnumerable<int> Grouped(string[][] parts) =>
        parts.GroupBy(g => g.Length, g => g.Select(t => t.Length))
            .Where(g => g.Key > 0)
            .Select(g => g.Key);

    /// <summary>A continuation reusing its range variable's name, with no query before it.</summary>
    public static IEnumerable<string> Renamed(string[] words) =>
        words.Select(w => w.ToUpperInvariant())
            .Where(w => w.Length > 1)
            .Select(w => w + "!");

    private static Tuple<int, bool>? Parse(string text) => int.TryParse(text, out var value) ? Tuple.Create(value, true) : null;
}
