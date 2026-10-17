using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace ClosuresLinq;

/// <summary>
/// Puts its operands through lambdas, closures, LINQ and iterators, and prints
/// what they did and in what order. The compiler turns each into classes and
/// methods of its own, so a Recovered Solution that captured a variable once
/// too often, ran a query too early or a <c>finally</c> too late behaves
/// differently.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int Failed = 2;

    private const string Usage =
        "Usage: ClosuresLinq <closures|loops|nested|local|multicast|kinds|query|people|numbers|deferred|globs|ranges|fibonacci|positives|tree|expressions> [operands...]";

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
                case "closures":
                    Counter(Ints(operands, 1)[0]);
                    break;
                case "loops":
                    Print(Closures.Loops(Ints(operands, 1)));
                    break;
                case "nested":
                    Print(Closures.Nested(Ints(operands, 1)));
                    break;
                case "local":
                    Print(Closures.LocalFunctions(Ints(operands, 1)[0]));
                    break;
                case "multicast":
                    Print(Closures.Multicast(operands));
                    break;
                case "kinds":
                    Print(Closures.Kinds(Ints(operands, 1)[0]));
                    break;
                case "query":
                    Query(operands);
                    break;
                case "people":
                    var people = Queries.People(operands);
                    Print(Queries.Floors(people));
                    Print(Queries.Anonymous(people));
                    break;
                case "numbers":
                    Print(Methods.Numbers(Ints(operands, 1)));
                    break;
                case "deferred":
                    Print(Methods.Deferred(Ints(operands, 0)));
                    break;
                case "globs":
                    Print(Methods.Globs(operands));
                    break;
                case "ranges":
                    Ranges(Ints(operands, 2));
                    break;
                case "fibonacci":
                    var count = Ints(operands, 1)[0];
                    Console.WriteLine($"the first {count}: [{string.Join(", ", Iterators.Fibonacci().Take(count))}]");
                    Console.WriteLine($"the first above 1000: {Iterators.Fibonacci().First(value => value > 1000)}");
                    break;
                case "positives":
                    Positives(Ints(operands, 0));
                    break;
                case "tree":
                    Tree(Ints(operands, 0));
                    break;
                case "expressions":
                    var operandsAsInts = Ints(operands, 2);
                    Print(Expressions.Describe(operandsAsInts[0], operandsAsInts[1]));
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
        catch (InvalidOperationException exception)
        {
            Console.Error.WriteLine($"{exception.GetType().Name}: {exception.Message}");
            return Failed;
        }

        return Succeeded;
    }

    private static void Print(IEnumerable<string> lines)
    {
        foreach (var line in lines)
        {
            Console.WriteLine(line);
        }
    }

    private static void Counter(int start)
    {
        var (next, reset) = Closures.Counter(start);
        Console.WriteLine($"next: {next()}, {next()}, {next()}");
        reset(start * 2);
        Console.WriteLine($"after reset to {start * 2}: {next()}");
        var (other, _) = Closures.Counter(start);
        Console.WriteLine($"another counter starts afresh: {other()}; the first goes on: {next()}");
        var add = Closures.Adder(start);
        Console.WriteLine($"an adder of {start}, changed after it was made, adds {add(1) - 1}");
    }

    private static void Query(string[] words)
    {
        Console.WriteLine($"longest first: [{string.Join(", ", Queries.Words(words))}]");
        Print(Queries.ByLength(words));
        var lengths = words.Select(word => word.Length).ToArray();
        Console.WriteLine($"even sums of lengths: [{string.Join(", ", Queries.Pairs(lengths))}]");
    }

    private static void Ranges(int[] operands)
    {
        var (start, count) = (operands[0], operands[1]);
        Console.WriteLine($"eager range: [{string.Join(", ", Iterators.EagerRange(start, count))}]");
        Console.WriteLine($"lazy range: [{string.Join(", ", Iterators.LazyRange(start, count))}]");
        var multipliers = Iterators.Multipliers(count).ToList();
        Console.WriteLine($"multipliers: [{string.Join(", ", multipliers.Select(multiplier => multiplier()))}]");

        // Given -count, the eager one throws when called, the lazy one only when enumerated.
        var lazy = Iterators.LazyRange(start, -count);
        Console.WriteLine("the lazy range with the count negated was made");
        try
        {
            Console.WriteLine($"enumerated, it has {lazy.Count()}");
        }
        catch (ArgumentOutOfRangeException exception)
        {
            Console.WriteLine($"enumerating it threw for {exception.ParamName}");
        }

        try
        {
            Console.WriteLine($"the eager range with the count negated has {Iterators.EagerRange(start, -count).Count()}");
        }
        catch (ArgumentOutOfRangeException exception)
        {
            Console.WriteLine($"making the eager range threw for {exception.ParamName}");
        }
    }

    private static void Positives(int[] values)
    {
        var log = new List<string>();
        var positives = Iterators.Positives(values, log);
        log.Add("made");
        foreach (var value in positives)
        {
            log.Add($"consumed {value}");
            if (value >= 100)
            {
                log.Add("breaking");
                break;
            }
        }

        log.Add($"taking 1 of it: {string.Join(", ", positives.Take(1))}");
        Print(log);
    }

    private static void Tree(int[] values)
    {
        var tree = new Tree();
        foreach (var value in values)
        {
            tree.Add(value);
        }

        Console.WriteLine($"in order: [{string.Join(", ", tree)}]");
        Console.WriteLine($"post order: [{string.Join(", ", tree.PostOrder())}]");
        Console.WriteLine($"the smallest three, doubled: [{string.Join(", ", tree.Take(3).Select(value => value * 2))}]");
    }

    /// <summary>The operands as ints; at least <paramref name="least"/> of them.</summary>
    private static int[] Ints(string[] operands, int least)
    {
        if (operands.Length < least)
        {
            throw new FormatException($"Give at least {least} int{(least == 1 ? "" : "s")}.");
        }

        var numbers = new int[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            numbers[i] = int.TryParse(operands[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out int value)
                ? value
                : throw new FormatException($"\"{operands[i]}\" is not an int.");
        }

        return numbers;
    }
}
