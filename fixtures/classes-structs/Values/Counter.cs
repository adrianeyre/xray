namespace ClassesStructs.Values;

public interface ICounter
{
    int Count { get; }

    void Increment();
}

/// <summary>
/// A mutable struct, copied wherever it is assigned or passed by value. Its
/// parameterless constructor starts it at 10, but default(Counter) is still
/// all zeros.
/// </summary>
public struct Counter : ICounter
{
    private int count;

    public Counter()
    {
        count = 10;
    }

    public Counter(int start)
    {
        count = start;
    }

    public readonly int Count => count;

    public void Increment() => count++;

    public override readonly string ToString() => $"Counter({count})";
}
