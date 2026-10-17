using System;
using System.Text;

namespace RecordsPatterns.Records;

/// <summary>A positional record struct, whose properties are mutable.</summary>
public record struct Point(int X, int Y)
{
    public readonly int ManhattanLength => Math.Abs(X) + Math.Abs(Y);

    public void Translate(int by)
    {
        X += by;
        Y += by;
    }
}

/// <summary>A readonly record struct, with an operator of its own.</summary>
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money left, Money right) =>
        left.Currency == right.Currency
            ? new Money(left.Amount + right.Amount, left.Currency)
            : throw new InvalidOperationException($"Cannot add {right.Currency} to {left.Currency}.");
}

/// <summary>
/// The base of a hierarchy of records. Its tags are an array, compared by
/// reference, as every member a record does not declare a comparison for.
/// </summary>
public abstract record Person(string Name)
{
    public string[] Tags { get; init; } = Array.Empty<string>();
}

public record Employee(string Name, int Level) : Person(Name)
{
    public string Grade => Level switch
    {
        < 3 => "junior",
        < 6 => "senior",
        _ => "principal",
    };
}

/// <summary>A sealed record at the bottom of the hierarchy: equal only to another Manager.</summary>
public sealed record Manager(string Name, int Level, int Reports) : Employee(Name, Level);

/// <summary>
/// A record whose positional parameter initializes a property it declares
/// itself, so the property is not the parameter: the name is trimmed.
/// </summary>
public record Tag(string Name)
{
    public string Name { get; init; } = Name.Trim().ToLowerInvariant();
}

/// <summary>
/// A record with equality and printing of its own: temperatures within a
/// tenth of a degree are equal, and it prints Fahrenheit too.
/// </summary>
public record Temperature(double Celsius)
{
    public double Fahrenheit => Math.Round(Celsius * 9 / 5 + 32, 1);

    public virtual bool Equals(Temperature? other) =>
        other is not null && Math.Abs(Celsius - other.Celsius) < 0.1;

    public override int GetHashCode() => 0;

    protected virtual bool PrintMembers(StringBuilder builder)
    {
        builder.Append($"{Celsius} C, {Fahrenheit} F");
        return true;
    }
}

/// <summary>A class with init-only properties, one of which checks and changes what it is given.</summary>
public sealed class Endpoint
{
    private readonly string host = "localhost";

    public string Host
    {
        get => host;
        init => host = value.Length == 0
            ? throw new FormatException("A host cannot be empty.")
            : value.ToLowerInvariant();
    }

    public int Port { get; init; } = 80;

    public bool Secure { get; set; }

    public override string ToString() => $"{(Secure ? "https" : "http")}://{Host}:{Port}";
}
