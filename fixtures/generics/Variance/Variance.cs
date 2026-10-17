namespace Generics.Variance;

/// <summary>Covariant: a producer of strings is a producer of objects.</summary>
public interface IProducer<out T>
{
    T Produce();
}

/// <summary>Contravariant: a consumer of objects is a consumer of strings.</summary>
public interface IConsumer<in T>
{
    string Consume(T item);
}

/// <summary>Both at once, on a delegate.</summary>
public delegate TResult Transform<in T, out TResult>(T input);

/// <summary>Invariant: a box of strings is not a box of objects.</summary>
public interface IBox<T>
{
    T Value { get; set; }
}

public sealed class Constant<T> : IProducer<T>, IBox<T>
{
    public Constant(T value)
    {
        Value = value;
    }

    public T Value { get; set; }

    public T Produce() => Value;
}

public sealed class Describer<T> : IConsumer<T>
{
    public string Consume(T item) => $"{typeof(T).Name} describer got {item}";
}
