using System;
using System.Collections.Generic;
using System.Linq;

namespace ClosuresLinq;

/// <summary>
/// LINQ in method syntax, and when it runs: a query runs each time it is
/// enumerated, against its source as it is then, and only as far as it is
/// enumerated; <c>ToList</c> runs it once, there and then.
/// </summary>
internal static class Methods
{
    public static IEnumerable<string> Numbers(int[] numbers)
    {
        yield return $"indexed: [{string.Join(", ", numbers.Select((number, index) => $"{index}:{number}"))}]";
        yield return $"odd squares: [{string.Join(", ", numbers.Where(number => number % 2 != 0).Select(number => number * number))}]";
        yield return $"distinct, descending: [{string.Join(", ", numbers.Distinct().OrderByDescending(number => number))}]";
        yield return $"by remainder, then value: [{string.Join(", ", numbers.OrderBy(number => Math.Abs(number % 3)).ThenByDescending(number => number))}]";
        yield return $"sum {numbers.Sum()}, min {numbers.Min()}, max {numbers.Max()}, average {numbers.Average():0.###}";
        yield return $"any negative: {numbers.Any(number => number < 0)}, all below 100: {numbers.All(number => number < 100)}, count of evens: {numbers.Count(number => number % 2 == 0)}";
        yield return $"aggregate: {numbers.Aggregate("seed", (text, number) => $"({text}*{number})", text => text.ToUpperInvariant())}";
        yield return $"zipped with their successors: [{string.Join(", ", numbers.Zip(numbers.Skip(1), (first, second) => second - first))}]";
        yield return $"chunks of 2: [{string.Join(" ", numbers.Chunk(2).Select(chunk => $"[{string.Join(",", chunk)}]"))}]";
        yield return $"until the first negative: [{string.Join(", ", numbers.TakeWhile(number => number >= 0))}], after it: [{string.Join(", ", numbers.SkipWhile(number => number >= 0).Skip(1))}]";
        var lookup = numbers.ToLookup(number => number % 2 == 0 ? "even" : "odd", number => number * 10);
        yield return $"lookup: even [{string.Join(", ", lookup["even"])}], odd [{string.Join(", ", lookup["odd"])}], none [{string.Join(", ", lookup["none"])}]";
        var grouped = numbers.GroupBy(number => number % 3, (key, group) => $"{key}={group.Sum()}");
        yield return $"sums by remainder: [{string.Join(", ", grouped)}]";
        yield return $"first above 10: {numbers.FirstOrDefault(number => number > 10, -1)}; last: {numbers.Last()}";
        yield return $"the only multiple of 7: {numbers.Single(number => number % 7 == 0)}";
    }

    /// <summary>When a query runs, and how much of it: each step it takes is logged.</summary>
    public static List<string> Deferred(int[] numbers)
    {
        var log = new List<string>();
        var source = new List<int>(numbers);
        var query = source
            .Where(number =>
            {
                log.Add($"where {number}");
                return number > 0;
            })
            .Select(number =>
            {
                log.Add($"select {number}");
                return number * 2;
            });

        log.Add("defined");
        source.Add(5);
        var snapshot = query.ToList();
        log.Add($"listed: [{string.Join(", ", snapshot)}]");
        source.Clear();
        source.Add(-1);
        source.Add(7);
        source.Add(8);
        log.Add($"first: {query.First()}");
        log.Add($"listed again: [{string.Join(", ", snapshot)}]; queried again: [{string.Join(", ", query)}]");
        return log;
    }

    /// <summary>
    /// Glob patterns, parsed part by part as BundlerMinifier's Minimatcher
    /// parses them: a pattern any of whose parts does not parse is left out.
    /// The decompiler writes these nested Selects as a query whose continuation
    /// follows a query, and reuses the outer range variable's name for it.
    /// </summary>
    public static IEnumerable<string> Globs(string[] patterns)
    {
        var parsed = patterns.Select(pattern => pattern.Split('/'))
            .Select(g => g.Select(t => Part(t)))
            .Where(g => !g.Contains(null))
            .Select(g => g.Select(t => t!.Item1))
            .ToList();
        yield return $"{parsed.Count} of {patterns.Length} parsed";
        foreach (var parts in parsed)
        {
            yield return string.Join(" / ", parts);
        }

        var widths = patterns.Select(pattern => pattern.Split('/'))
            .Select(g => g.Select(t => t.Length).Select(n => n + 1))
            .Select(g => g.Sum() - 1);
        yield return $"widths: [{string.Join(", ", widths)}]";
    }

    /// <summary>What a part of a glob matches, and whether it is a wildcard; null if its brackets do not pair.</summary>
    private static Tuple<string, bool>? Part(string text)
    {
        var open = text.Count(character => character == '[');
        if (open != text.Count(character => character == ']'))
        {
            return null;
        }

        var wildcard = open > 0 || text.Contains('*') || text.Contains('?');
        var described = text switch
        {
            "" => "<empty>",
            "**" => "<any path>",
            _ => text.Replace("*", "<any>").Replace("?", "<one>"),
        };
        return Tuple.Create(wildcard ? $"{described} (wildcard)" : described, wildcard);
    }
}
