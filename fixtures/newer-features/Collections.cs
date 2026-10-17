using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Runtime.CompilerServices;

namespace NewerFeatures;

/// <summary>Collection expressions, for each kind of collection the compiler builds differently.</summary>
public static class Collections
{
    public static int[] Array(int first, int second) => [first, second, first + second];

    /// <summary>An empty array: the same one every time.</summary>
    public static int[] None() => [];

    public static List<int> Joined(int[] first, IEnumerable<int> second) => [.. first, 0, .. second];

    /// <summary>A read-only collection of the compiler's own.</summary>
    public static IEnumerable<int> Sequence(int first, int second) => [first, second];

    /// <summary>A mutable interface, so a List.</summary>
    public static IList<int> Mutable(int value) => [value];

    public static IReadOnlyList<int> Copy(List<int> values) => [.. values];

    public static HashSet<string> Distinct(string[] words) => [.. words, "and"];

    public static ImmutableArray<int> Immutable(int value) => [value, value * 2];

    public static Bag<int> Bag(int first, int second) => [first, second, first * second];

    /// <summary>A span on the stack, of values only known at run time.</summary>
    public static int Sum(int first, int second, int third)
    {
        ReadOnlySpan<int> values = [first, second, third];
        var sum = 0;
        foreach (var value in values)
        {
            sum += value;
        }

        return sum;
    }

    /// <summary>A span of constants, stored in the Assembly itself.</summary>
    public static ReadOnlySpan<byte> Magic => [0x58, 0x52, 0x41, 0x59];

    /// <summary>Elements and spreads are evaluated, and spreads enumerated, in order.</summary>
    public static int[] Ordered(List<string> log)
    {
        return [Logged(1, log), .. Each(log), Logged(4, log)];

        static IEnumerable<int> Each(List<string> log)
        {
            log.Add("spread started");
            yield return Logged(2, log);
            yield return Logged(3, log);
            log.Add("spread ended");
        }
    }

    private static int Logged(int value, List<string> log)
    {
        log.Add($"element {value}");
        return value;
    }

    /// <summary>What kind of collection a collection expression made.</summary>
    public static string Kind<T>(IEnumerable<T> values) => values switch
    {
        T[] array => $"an array of {array.Length}",
        List<T> list => $"a List of {list.Count}",
        ICollection<T> { IsReadOnly: true } collection => $"a read-only collection of {collection.Count}",
        ICollection<T> collection => $"a {values.GetType().Name} of {collection.Count}",
        _ => $"a {values.GetType().Name}",
    };
}

/// <summary>A collection the compiler builds with a method of its choosing, which logs it.</summary>
[CollectionBuilder(typeof(Bag), nameof(Bag.Create))]
public sealed class Bag<T>(T[] items) : IEnumerable<T>
{
    public IEnumerator<T> GetEnumerator() => ((IEnumerable<T>)items).GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    public override string ToString() => $"Bag({string.Join(", ", items)})";
}

public static class Bag
{
    public static int Created { get; private set; }

    public static Bag<T> Create<T>(ReadOnlySpan<T> items)
    {
        Created++;
        return new Bag<T>(items.ToArray());
    }
}
