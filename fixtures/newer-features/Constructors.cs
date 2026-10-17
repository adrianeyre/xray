using System;
using System.Collections.Generic;

namespace NewerFeatures;

/// <summary>
/// A class with a primary constructor. Its name only initializes a property,
/// so the class does not keep it; its start is captured, kept in a field of
/// the compiler's, and changed by every call to <see cref="Next"/>.
/// </summary>
public class Counter(string name, int start = 1)
{
    public string Name { get; } = name.ToUpperInvariant();

    public int Next() => start++;

    /// <summary>A lambda that reads the captured parameter through this.</summary>
    public Func<int> Peek() => () => start;

    public override string ToString() => $"{Name} at {start}";
}

/// <summary>A primary constructor beside another constructor, which must call it.</summary>
public class Interval(int start, int end)
{
    public Interval(int end)
        : this(0, end)
    {
    }

    public int Start => start;

    public int Length => end - start;

    /// <summary>An iterator over the captured parameters.</summary>
    public IEnumerable<int> Values()
    {
        for (var i = start; i < end; i++)
        {
            yield return i;
        }
    }
}

/// <summary>A derived class passing its primary constructor's parameters on to its base's.</summary>
public sealed class Labelled(string label, int start, int end) : Interval(start, end)
{
    public string Describe() => $"{label}: {Start} to {Start + Length}";
}

/// <summary>
/// A struct with a primary constructor that captures its parameter. Created
/// with <c>new()</c> or as <c>default</c>, it starts from zero.
/// </summary>
public struct Tally(int count)
{
    public void Add(int value) => count += value;

    public readonly int Count => count;
}

/// <summary>A primary constructor whose parameters only initialize fields, with a check.</summary>
public sealed class Temperature(double celsius)
{
    private readonly double kelvin = celsius < -273.15
        ? throw new ArgumentOutOfRangeException(nameof(celsius), $"{celsius} C is below absolute zero.")
        : celsius + 273.15;

    public override string ToString() => $"{Math.Round(kelvin, 2)} K";
}
