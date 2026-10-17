using System;
using System.Collections;
using System.Collections.Generic;

namespace ClosuresLinq;

/// <summary>
/// Iterators: methods with <c>yield return</c>, which the compiler turns into
/// a state machine of its own. What runs when — the iterator's body, its
/// <c>finally</c> blocks, its argument checks — shows in a log.
/// </summary>
internal static class Iterators
{
    /// <summary>Checked when enumerated, as the whole body of an iterator runs only then.</summary>
    public static IEnumerable<int> LazyRange(int start, int count)
    {
        if (count < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(count), "Count must not be negative.");
        }

        for (var i = 0; i < count; i++)
        {
            yield return start + i;
        }
    }

    /// <summary>Checked when called: the checks are outside the iterator, a local function.</summary>
    public static IEnumerable<int> EagerRange(int start, int count)
    {
        if (count < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(count), "Count must not be negative.");
        }

        return Range();

        IEnumerable<int> Range()
        {
            for (var i = 0; i < count; i++)
            {
                yield return start + i;
            }
        }
    }

    /// <summary>Never ends: its consumer decides how much of it to take.</summary>
    public static IEnumerable<long> Fibonacci()
    {
        long current = 0;
        long next = 1;
        while (true)
        {
            yield return current;
            (current, next) = (next, current + next);
        }
    }

    /// <summary>Up to the first value that is not positive, logging what it produces and when it is done.</summary>
    public static IEnumerable<int> Positives(int[] values, List<string> log)
    {
        log.Add("started");
        try
        {
            foreach (var value in values)
            {
                if (value <= 0)
                {
                    log.Add($"stopping at {value}");
                    yield break;
                }

                try
                {
                    log.Add($"producing {value}");
                    yield return value;
                    log.Add($"resumed after {value}");
                }
                finally
                {
                    log.Add($"inner finally after {value}");
                }
            }

            log.Add("ran out");
        }
        finally
        {
            log.Add("outer finally");
        }
    }

    /// <summary>A lambda inside an iterator, capturing one of its locals.</summary>
    public static IEnumerable<Func<int>> Multipliers(int count)
    {
        for (var i = 1; i <= count; i++)
        {
            var factor = i;
            yield return () => factor * 10;
        }
    }
}

/// <summary>A binary search tree, enumerated in order by recursive iterators.</summary>
internal sealed class Tree : IEnumerable<int>
{
    private Node? root;

    public void Add(int value)
    {
        ref var node = ref root;
        while (node is not null)
        {
            node = ref value < node.Value ? ref node.Left : ref node.Right;
        }

        node = new Node(value);
    }

    public IEnumerator<int> GetEnumerator()
    {
        foreach (var value in InOrder(root))
        {
            yield return value;
        }
    }

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    /// <summary>Each value with its depth, deepest first, root last.</summary>
    public IEnumerable<string> PostOrder() => PostOrder(root, 0);

    private static IEnumerable<int> InOrder(Node? node)
    {
        if (node is null)
        {
            yield break;
        }

        foreach (var value in InOrder(node.Left))
        {
            yield return value;
        }

        yield return node.Value;
        foreach (var value in InOrder(node.Right))
        {
            yield return value;
        }
    }

    private static IEnumerable<string> PostOrder(Node? node, int depth)
    {
        if (node is null)
        {
            yield break;
        }

        foreach (var text in PostOrder(node.Left, depth + 1))
        {
            yield return text;
        }

        foreach (var text in PostOrder(node.Right, depth + 1))
        {
            yield return text;
        }

        yield return $"{node.Value}@{depth}";
    }

    private sealed class Node(int value)
    {
        public int Value { get; } = value;

        public Node? Left;

        public Node? Right;
    }
}
