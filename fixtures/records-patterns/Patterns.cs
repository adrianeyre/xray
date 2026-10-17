using System;
using System.Collections.Generic;
using RecordsPatterns.Records;

namespace RecordsPatterns;

public enum Suit
{
    Clubs,
    Diamonds,
    Hearts,
    Spades,
}

public sealed record Address(string City, string Country);

public sealed record Customer(string Name, Address? Address);

public sealed record Order(Customer Customer, decimal Total, int Items);

/// <summary>Relational, logical, list, tuple and extended property patterns.</summary>
public static class Patterns
{
    public static string Size(int value) => value switch
    {
        < 0 => "negative",
        0 => "zero",
        1 or 2 or 3 => "small",
        >= 4 and <= 9 => "a single digit",
        < 100 => "two digits",
        _ => "large",
    };

    public static string FizzBuzz(int value) => (value % 3, value % 5) switch
    {
        (0, 0) => "FizzBuzz",
        (0, _) => "Fizz",
        (_, 0) => "Buzz",
        _ => value.ToString(),
    };

    /// <summary>NaN fails every comparison, so it must be matched before the arm that takes the rest.</summary>
    public static string Weather(double celsius) => celsius switch
    {
        < 0.0 => "freezing",
        >= 0.0 and < 15.5 => "cold",
        < 25 => "mild",
        double.NaN => "unknown",
        _ => "hot",
    };

    public static string Character(char c) => c switch
    {
        >= 'a' and <= 'z' or >= 'A' and <= 'Z' => "a letter",
        >= '0' and <= '9' => "a digit",
        ' ' or '\t' => "a space",
        _ => "a symbol",
    };

    public static string List(int[] values) => values switch
    {
        [] => "empty",
        [var only] => $"just {only}",
        [var first, var second] when first == second => $"a pair of {first}s",
        [0, ..] => "starts with zero",
        [.., < 0] => "ends below zero",
        [var first, .. var middle, var last] when middle.Length > 2 => $"{first}, then {middle.Length} more ({string.Join(" ", middle)}), then {last}",
        [_, _, ..] all => $"{all.Length} values from {all[0]} to {all[^1]}",
    };

    /// <summary>A list pattern on a List, which has a Count and an indexer but no slice.</summary>
    public static string Prefix(List<int> values) => values switch
    {
        [1, 2, 3, ..] => "counts up from one",
        [_, > 100, ..] => "has a large second value",
        [.., var last] when last % 2 == 0 => $"ends with the even {last}",
        { Count: > 5 } => "is long",
        _ => "is unremarkable",
    };

    /// <summary>List patterns on a string, sliced as a string.</summary>
    public static string Word(string word) => word switch
    {
        "" => "empty",
        ['#', .. var rest] => $"a tag named \"{rest}\"",
        [var first, ..] when char.IsDigit(first) => "starts with a digit",
        [.., '?'] => "a question",
        [var first, .., var last] when first == last && word.Length > 1 => $"starts and ends with '{first}'",
        { Length: > 10 } => "a long word",
        _ => "a word",
    };

    /// <summary>List patterns on a span of characters.</summary>
    public static bool IsQuoted(ReadOnlySpan<char> text) => text is ['"', .., '"'] or ['\'', .., '\''];

    public static string Shipping(Order order) => order switch
    {
        { Customer.Address: null } => "nowhere to send it",
        { Customer.Address.Country: not "UK" } => "international",
        { Total: >= 100m } or { Items: > 10 } => "free UK delivery",
        { Customer.Address.City: "London" or "Leeds" } => "next day",
        _ => "standard",
    };

    /// <summary>A switch statement over any value, with type patterns, guards and fall-through cases.</summary>
    public static string Inspect(object? value)
    {
        switch (value)
        {
            case null:
                return "null";
            case int number when number < 0:
                return $"a negative int, {number}";
            case int and (0 or 1):
                return "a bit";
            case int number:
                return $"an int, {Size(number)}";
            case long or short or byte:
                return $"some other integer, a {value.GetType().Name}";
            case string { Length: 0 }:
                return "an empty string";
            case string text when text.Trim() is []:
                return "a blank string";
            case string text:
                return $"a string, {Word(text)}";
            case Point(0, 0):
                return "the origin";
            case Point { X: var x, Y: var y } when x == y:
                return $"a point on the diagonal at {x}";
            case Point point:
                return $"a point {point.ManhattanLength} blocks away";
            case int[] { Length: > 0 } numbers:
                return $"an int array, {List(numbers)}";
            case IEnumerable<int>:
                return "a sequence of ints";
            default:
                return $"a {value.GetType().Name}";
        }
    }

    public static string Positive(object? value)
    {
        if (value is not int number)
        {
            return "not an int";
        }

        return number is > 0 ? $"{number} is positive" : $"{number} is not positive";
    }

#pragma warning disable CS8524 // An unnamed value, such as (Suit)9, matches no arm: it throws, which the Fixture shows.
    public static string Colour(Suit suit) => suit switch
    {
        Suit.Clubs or Suit.Spades => "black",
        Suit.Diamonds or Suit.Hearts => "red",
    };
#pragma warning restore CS8524
}
