namespace Generics.Collections;

/// <summary>Two values of any two types.</summary>
public readonly struct Pair<TFirst, TSecond>
{
    public Pair(TFirst first, TSecond second)
    {
        First = first;
        Second = second;
    }

    public TFirst First { get; }

    public TSecond Second { get; }

    public Pair<TSecond, TFirst> Swap() => new(Second, First);

    public Pair<TFirst, TResult> With<TResult>(TResult second) => new(First, second);

    public override string ToString() => $"({First}, {Second})";
}

/// <summary>A non-generic type beside the generic one, whose type arguments its method infers.</summary>
public static class Pair
{
    public static Pair<TFirst, TSecond> Of<TFirst, TSecond>(TFirst first, TSecond second) => new(first, second);
}
