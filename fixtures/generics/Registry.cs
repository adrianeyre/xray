namespace Generics;

/// <summary>Static state of which each constructed type has its own copy.</summary>
public static class Registry<T>
{
    private static int count;

    public static readonly string Name = Program.TypeName(typeof(T));

    public static int Register() => ++count;
}

/// <summary>A generic type nested in another, which sees both type parameters.</summary>
public sealed class Outer<T>
{
    public sealed class Inner<U>
    {
        public string Describe(T outer, U inner) =>
            $"Outer<{Program.TypeName(typeof(T))}>.Inner<{Program.TypeName(typeof(U))}> holds {outer} and {inner}";
    }
}
