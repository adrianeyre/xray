using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Runtime.Versioning;
using System.Threading.Tasks;
using Measures;

namespace NetStandard20Library;

/// <summary>
/// Converts, adds and compares quantities with Measures, a .NET Standard 2.0
/// library. It says which framework the library was built for, so a Recovered
/// Solution that built Measures for another framework would behave
/// differently.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int Unreadable = 2;
    private const int Incompatible = 3;

    private const string Usage =
        "Usage: NetStandard20Library <framework|units|convert|add|scale|compare|range|describe> [operands...]";

    private static async Task<int> Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        try
        {
            switch (args[0])
            {
                case "framework":
                    var framework = typeof(Quantity).Assembly.GetCustomAttribute<TargetFrameworkAttribute>();
                    Console.WriteLine($"Measures: {framework?.FrameworkName ?? "no TargetFrameworkAttribute"}");
                    return Succeeded;
                case "units":
                    foreach (var (dimension, symbols) in Units.ByDimension())
                    {
                        Console.WriteLine($"{dimension}: {string.Join(", ", symbols)}");
                    }
                    return Succeeded;
                case "convert":
                {
                    var quantity = Read(Operand(args, 1));
                    if (!Units.TryFind(Operand(args, 2), out var unit))
                    {
                        throw new UnreadableException($"Unknown unit \"{args[2]}\".");
                    }
                    Console.WriteLine($"{quantity} = {quantity.To(unit)}");
                    return Succeeded;
                }
                case "add":
                {
                    var quantities = new List<Quantity>();
                    for (var i = 1; i < args.Length; i++)
                    {
                        quantities.Add(Read(args[i]));
                    }
                    Console.WriteLine(await Quantities.SumAsync(quantities));
                    return Succeeded;
                }
                case "scale":
                {
                    var quantity = Read(Operand(args, 1));
                    var factor = decimal.Parse(Operand(args, 2), NumberStyles.Number, CultureInfo.InvariantCulture);
                    Console.WriteLine(Quantity.Scale(quantity, factor));
                    return Succeeded;
                }
                case "compare":
                {
                    var left = Read(Operand(args, 1));
                    var right = Read(Operand(args, 2));
                    var order = left.CompareTo(right);
                    var sign = left.Equals(right) ? "=" : order < 0 ? "<" : order > 0 ? ">" : "~";
                    Console.WriteLine($"{left} {sign} {right}");
                    return Succeeded;
                }
                case "range":
                    foreach (var quantity in Quantities.Range(Read(Operand(args, 1)), Read(Operand(args, 2)), Read(Operand(args, 3))))
                    {
                        Console.WriteLine(quantity);
                    }
                    return Succeeded;
                case "describe":
                    if (args.Length < 2)
                    {
                        Console.WriteLine(Quantities.Describe(null));
                        return Succeeded;
                    }
                    var (read, error) = Quantities.Parse(args[1]);
                    Console.WriteLine(Quantities.Describe(error is null ? read : args[1]));
                    return Succeeded;
                default:
                    Console.Error.WriteLine($"Unknown command \"{args[0]}\".");
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (UnreadableException e)
        {
            Console.Error.WriteLine(e.Message);
            return Unreadable;
        }
        catch (IncompatibleUnitsException e)
        {
            Console.Error.WriteLine(e.Message);
            return Incompatible;
        }
        catch (FormatException)
        {
            Console.Error.WriteLine("Factors must be numbers.");
            return InvalidInput;
        }
        catch (ArgumentOutOfRangeException)
        {
            // Not the exception's message, which names its parameter.
            Console.Error.WriteLine("The step must be more than nothing.");
            return InvalidInput;
        }
        catch (ArgumentException)
        {
            Console.Error.WriteLine("Nothing to add.");
            return InvalidInput;
        }
    }

    private static string Operand(string[] args, int index) =>
        args.Length > index ? args[index] : throw new UnreadableException("Too few operands.");

    private static Quantity Read(string text)
    {
        var (quantity, error) = Quantities.Parse(text);
        return error is null ? quantity : throw new UnreadableException(error);
    }

    private sealed class UnreadableException(string message) : Exception(message);
}
