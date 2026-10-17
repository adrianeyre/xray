using System.Numerics;

namespace Generics;

/// <summary>Static abstract members: a type says what its empty value is and how two combine.</summary>
public interface IMonoid<TSelf>
    where TSelf : IMonoid<TSelf>
{
    static abstract TSelf Empty { get; }

    static abstract TSelf operator +(TSelf left, TSelf right);
}

public readonly struct Text : IMonoid<Text>
{
    public Text(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static Text Empty => new("");

    public static Text operator +(Text left, Text right) => new(left.Value + right.Value);

    public override string ToString() => $"\"{Value}\"";
}

public readonly struct Maximum : IMonoid<Maximum>
{
    public Maximum(int value)
    {
        Value = value;
    }

    public int Value { get; }

    public static Maximum Empty => new(int.MinValue);

    public static Maximum operator +(Maximum left, Maximum right) => left.Value >= right.Value ? left : right;

    public override string ToString() => $"max {Value}";
}

public static class Monoid
{
    public static T Concat<T>(params T[] items)
        where T : IMonoid<T>
    {
        var result = T.Empty;
        foreach (var item in items)
        {
            result += item;
        }

        return result;
    }

    /// <summary>The same, through the base class library's generic math.</summary>
    public static T Sum<T>(T[] values)
        where T : INumber<T>
    {
        var sum = T.Zero;
        foreach (var value in values)
        {
            sum += value;
        }

        return sum;
    }
}
