using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using NewerFeatures.Files;

namespace NewerFeatures;

/// <summary>
/// Puts its operands through primary constructors, collection expressions
/// and file-scoped types, and prints what they did. It reads back by
/// reflection the fields the compiler keeps captured parameters in, the
/// constructors it declares, and which types are file-scoped, so a Recovered
/// Solution that rewrote a primary constructor as an ordinary one, or a
/// file-scoped type as one visible everywhere, describes itself differently.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int Failed = 2;

    private const string Usage =
        "Usage: NewerFeatures <counter|intervals|tally|temperature|collections|ordered|files|members> [operands...]";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        var operands = args[1..];
        try
        {
            switch (args[0])
            {
                case "counter":
                    Counter(operands);
                    break;
                case "intervals":
                    Intervals(Ints(operands));
                    break;
                case "tally":
                    Tally(Ints(operands));
                    break;
                case "temperature":
                    foreach (var operand in operands)
                    {
                        Console.WriteLine($"{operand} C is {new Temperature(Double(operand))}");
                    }

                    break;
                case "collections":
                    Collections(Ints(operands));
                    break;
                case "ordered":
                    var log = new List<string>();
                    var ordered = NewerFeatures.Collections.Ordered(log);
                    Console.WriteLine(string.Join(", ", log));
                    Console.WriteLine($"[{string.Join(", ", ordered)}]");
                    break;
                case "files":
                    Files(operands);
                    break;
                case "members":
                    Members();
                    break;
                default:
                    Console.Error.WriteLine($"Unknown command \"{args[0]}\".");
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (FormatException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return InvalidInput;
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return Failed;
        }

        return Succeeded;
    }

    private static void Counter(string[] operands)
    {
        var counter = operands switch
        {
            [var name] => new Counter(name),
            [var name, var start] => new Counter(name, Ints([start])[0]),
            _ => throw new FormatException("Usage: NewerFeatures counter <name> [start]"),
        };
        var peek = counter.Peek();
        Console.WriteLine($"{counter}: next {counter.Next()}, {counter.Next()}, then {counter.Next()}; peeking {peek()}");
        Console.WriteLine($"another: {new Counter(counter.Name.ToLowerInvariant())}");
    }

    private static void Intervals(int[] bounds)
    {
        var interval = bounds switch
        {
            [var end] => new Interval(end),
            [var start, var end] => new Interval(start, end),
            _ => throw new FormatException("Usage: NewerFeatures intervals [start] <end>"),
        };
        Console.WriteLine($"from {interval.Start}, {interval.Length} long: [{string.Join(", ", interval.Values())}]");
        var labelled = new Labelled("labelled", interval.Start, interval.Start + interval.Length);
        Console.WriteLine($"{labelled.Describe()}: [{string.Join(", ", labelled.Values())}]");
    }

    private static void Tally(int[] values)
    {
        var tally = new Tally(100);
        var fresh = new Tally();
        foreach (var value in values)
        {
            tally.Add(value);
            fresh.Add(value);
        }

        // A struct is copied, so adding to the copy leaves the original.
        var copy = tally;
        copy.Add(1000);
        Console.WriteLine($"from 100: {tally.Count}; from new(): {fresh.Count}; from default: {default(Tally).Count}; the copy: {copy.Count}");
    }

    private static void Collections(int[] values)
    {
        if (values.Length < 2)
        {
            throw new FormatException("Give at least two ints.");
        }

        var (first, second) = (values[0], values[1]);
        var array = NewerFeatures.Collections.Array(first, second);
        Console.WriteLine($"array: [{string.Join(", ", array)}], {NewerFeatures.Collections.Kind(array)}");
        Console.WriteLine($"none: {NewerFeatures.Collections.Kind(NewerFeatures.Collections.None())}, the same each time: {ReferenceEquals(NewerFeatures.Collections.None(), NewerFeatures.Collections.None())}");
        var joined = NewerFeatures.Collections.Joined(values, NewerFeatures.Collections.Sequence(second, first));
        Console.WriteLine($"joined: [{string.Join(", ", joined)}], {NewerFeatures.Collections.Kind(joined)}");
        var sequence = NewerFeatures.Collections.Sequence(first, second);
        Console.WriteLine($"sequence: [{string.Join(", ", sequence)}], {NewerFeatures.Collections.Kind(sequence)}");
        try
        {
            ((ICollection<int>)sequence).Add(0);
            Console.WriteLine("added to the sequence");
        }
        catch (NotSupportedException exception)
        {
            Console.WriteLine($"adding to the sequence throws {exception.GetType().Name}");
        }

        var mutable = NewerFeatures.Collections.Mutable(first);
        mutable.Add(second);
        Console.WriteLine($"mutable: [{string.Join(", ", mutable)}], {NewerFeatures.Collections.Kind(mutable)}");
        var copied = NewerFeatures.Collections.Copy(new List<int>(values));
        Console.WriteLine($"copied: [{string.Join(", ", copied)}], {NewerFeatures.Collections.Kind(copied)}");
        var words = new string[values.Length];
        for (var i = 0; i < values.Length; i++)
        {
            words[i] = values[i] % 2 == 0 ? "even" : "odd";
        }

        var distinct = NewerFeatures.Collections.Distinct(words);
        var sorted = new List<string>(distinct);
        sorted.Sort(StringComparer.Ordinal);
        Console.WriteLine($"distinct: [{string.Join(", ", sorted)}], {NewerFeatures.Collections.Kind(distinct)}");
        var immutable = NewerFeatures.Collections.Immutable(first);
        Console.WriteLine($"immutable: [{string.Join(", ", immutable)}], {NewerFeatures.Collections.Kind(immutable)}");
        var bag = NewerFeatures.Collections.Bag(first, second);
        Console.WriteLine($"{bag}, {Bag.Created} made by its builder");
        Console.WriteLine($"sum on the stack: {NewerFeatures.Collections.Sum(first, second, values[^1])}");
        Console.WriteLine($"magic: {System.Text.Encoding.ASCII.GetString(NewerFeatures.Collections.Magic)}");
    }

    private static void Files(string[] names)
    {
        foreach (var name in names)
        {
            Console.WriteLine($"{Greetings.Greet(name)} {Farewells.Part(name)}");
        }

        Console.WriteLine($"Greetings' Format: {Scope(Greetings.FormatType)}");
        Console.WriteLine($"Greetings' Shouter: {Scope(Greetings.ShouterType)}, an IShout: {Greetings.ShouterType.GetInterfaces()[0].Name.EndsWith("__IShout", StringComparison.Ordinal)}");
        Console.WriteLine($"Farewells' Format: {Scope(Farewells.FormatType)}");
        Console.WriteLine($"the two Formats are the same type: {Greetings.FormatType == Farewells.FormatType}");
    }

    /// <summary>
    /// Where a type is visible. A file-scoped type's name is the name of its
    /// file, a checksum of its path (which differs from machine to machine)
    /// and its own name: &lt;Greetings&gt;F1A2B…__Format.
    /// </summary>
    private static string Scope(Type type)
    {
        var match = Regex.Match(type.Name, "^<(?<file>.+)>F[0-9A-F]{64}__(?<name>.+)$");
        return match.Success
            ? $"{match.Groups["name"].Value}, scoped to its file, {match.Groups["file"].Value}.cs"
            : $"{type.Name}, visible outside its file";
    }

    /// <summary>The fields and constructors of each type with a primary constructor.</summary>
    private static void Members()
    {
        foreach (var type in new[] { typeof(Counter), typeof(Interval), typeof(Labelled), typeof(Tally), typeof(Temperature), typeof(Bag<>) })
        {
            const BindingFlags declared = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;
            var fields = new List<string>();
            foreach (var field in type.GetFields(declared))
            {
                fields.Add($"{(field.IsInitOnly ? "readonly " : "")}{field.FieldType.Name} {field.Name}");
            }

            var constructors = new List<string>();
            foreach (var constructor in type.GetConstructors(declared))
            {
                var parameters = new List<string>();
                foreach (var parameter in constructor.GetParameters())
                {
                    parameters.Add($"{parameter.ParameterType.Name} {parameter.Name}{(parameter.HasDefaultValue ? $" = {parameter.DefaultValue}" : "")}");
                }

                constructors.Add($"({string.Join(", ", parameters)})");
            }

            fields.Sort(StringComparer.Ordinal);
            constructors.Sort(StringComparer.Ordinal);
            Console.WriteLine(type.Name);
            Console.WriteLine($"  fields: {string.Join(", ", fields)}");
            Console.WriteLine($"  constructors: {string.Join(", ", constructors)}");
        }
    }

    private static int[] Ints(string[] operands)
    {
        var numbers = new int[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            numbers[i] = int.TryParse(operands[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
                ? value
                : throw new FormatException($"\"{operands[i]}\" is not an int.");
        }

        return numbers;
    }

    private static double Double(string text) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : throw new FormatException($"\"{text}\" is not a number.");
}
