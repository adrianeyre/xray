using System;
using System.Globalization;

namespace Arithmetic;

/// <summary>
/// Applies the arithmetic operators to two operands of one numeric type and
/// prints each result, one per line. The operands come from the command line,
/// so the compiler cannot fold the arithmetic away: the Assembly carries it as IL.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int DividedByZero = 2;
    private const int Overflowed = 3;

    private const string Usage = "Usage: Arithmetic <int|long|double|decimal> <left> <right>";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length != 3)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        string type = args[0];
        string left = args[1];
        string right = args[2];
        try
        {
            switch (type)
            {
                case "int":
                    Int32s(ParseInt32(left), ParseInt32(right));
                    break;
                case "long":
                    Int64s(ParseInt64(left), ParseInt64(right));
                    break;
                case "double":
                    Doubles(ParseDouble(left), ParseDouble(right));
                    break;
                case "decimal":
                    Decimals(ParseDecimal(left), ParseDecimal(right));
                    break;
                default:
                    Console.Error.WriteLine($"Unknown type \"{type}\".");
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (FormatException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return InvalidInput;
        }
        catch (DivideByZeroException)
        {
            Console.Error.WriteLine("Cannot divide by zero.");
            return DividedByZero;
        }
        catch (OverflowException)
        {
            Console.Error.WriteLine($"{type} arithmetic overflowed.");
            return Overflowed;
        }

        return Succeeded;
    }

    private static void Int32s(int a, int b)
    {
        // Unchecked by default: these wrap around on overflow.
        Console.WriteLine($"{a} + {b} = {a + b}");
        Console.WriteLine($"{a} - {b} = {a - b}");
        Console.WriteLine($"{a} * {b} = {a * b}");
        Console.WriteLine($"checked({a} + {b}) = {checked(a + b)}");
        Console.WriteLine($"checked({a} * {b}) = {checked(a * b)}");
        Console.WriteLine($"{a} / {b} = {a / b}");
        Console.WriteLine($"{a} % {b} = {a % b}");
        Console.WriteLine($"-({a}) = {-a}");
        Console.WriteLine($"{a} & {b} = {a & b}");
        Console.WriteLine($"{a} | {b} = {a | b}");
        Console.WriteLine($"{a} ^ {b} = {a ^ b}");
        Console.WriteLine($"~({a}) = {~a}");
        Console.WriteLine($"{a} << {b} = {a << b}");
        Console.WriteLine($"{a} >> {b} = {a >> b}");
        Console.WriteLine($"{a} >>> {b} = {a >>> b}");
        Console.WriteLine($"(double){a} / {b} = {(double)a / b}");
        Console.WriteLine($"(byte){a} = {(byte)a}");

        int x = a;
        int before = x++;
        int after = ++x;
        Console.WriteLine($"x = {a}; x++ is {before}, then ++x is {after}");
        x = a;
        x += b;
        x *= b;
        x -= a;
        Console.WriteLine($"x = {a}; x += {b}; x *= {b}; x -= {a} leaves {x}");
    }

    private static void Int64s(long a, long b)
    {
        Console.WriteLine($"{a} + {b} = {a + b}");
        Console.WriteLine($"{a} - {b} = {a - b}");
        Console.WriteLine($"{a} * {b} = {a * b}");
        Console.WriteLine($"checked({a} * {b}) = {checked(a * b)}");
        Console.WriteLine($"{a} / {b} = {a / b}");
        Console.WriteLine($"{a} % {b} = {a % b}");
        Console.WriteLine($"{a} << {b} = {a << (int)b}");
        Console.WriteLine($"{a} >> {b} = {a >> (int)b}");
        Console.WriteLine($"(int){a} = {(int)a}");
        Console.WriteLine($"Math.DivRem({a}, {b}) = {Math.DivRem(a, b)}");
    }

    private static void Doubles(double a, double b)
    {
        // Only operations IEEE 754 defines exactly, so every OS and CPU agrees.
        Console.WriteLine($"{a} + {b} = {a + b}");
        Console.WriteLine($"{a} - {b} = {a - b}");
        Console.WriteLine($"{a} * {b} = {a * b}");
        Console.WriteLine($"{a} / {b} = {a / b}");
        Console.WriteLine($"{a} % {b} = {a % b}");
        Console.WriteLine($"-({a}) = {-a}");
        Console.WriteLine($"Math.Sqrt({a}) = {Math.Sqrt(a)}");
        Console.WriteLine($"Math.Floor({a} / {b}) = {Math.Floor(a / b)}");
        Console.WriteLine($"Math.Ceiling({a} / {b}) = {Math.Ceiling(a / b)}");
        Console.WriteLine($"Math.Truncate({a} / {b}) = {Math.Truncate(a / b)}");
        Console.WriteLine($"Math.Round({a} / {b}, 3) = {Math.Round(a / b, 3)}");
        Console.WriteLine($"{a} == {b} is {a == b}, {a} < {b} is {a < b}");
    }

    private static void Decimals(decimal a, decimal b)
    {
        Console.WriteLine($"{a} + {b} = {a + b}");
        Console.WriteLine($"{a} - {b} = {a - b}");
        Console.WriteLine($"{a} * {b} = {a * b}");
        Console.WriteLine($"{a} / {b} = {a / b}");
        Console.WriteLine($"{a} % {b} = {a % b}");
        Console.WriteLine($"-({a}) = {-a}");
        Console.WriteLine($"Math.Round({a} / {b}) = {Math.Round(a / b)}");
        Console.WriteLine($"Math.Round({a} / {b}, MidpointRounding.AwayFromZero) = {Math.Round(a / b, MidpointRounding.AwayFromZero)}");
        Console.WriteLine($"Math.Round({a} / {b}, 2) = {Math.Round(a / b, 2)}");
        Console.WriteLine($"decimal.Truncate({a} / {b}) = {decimal.Truncate(a / b)}");
    }

    private static int ParseInt32(string text) =>
        int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out int value)
            ? value
            : throw new FormatException($"\"{text}\" is not an int.");

    private static long ParseInt64(string text) =>
        long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out long value)
            ? value
            : throw new FormatException($"\"{text}\" is not a long.");

    private static double ParseDouble(string text) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double value)
            ? value
            : throw new FormatException($"\"{text}\" is not a double.");

    private static decimal ParseDecimal(string text) =>
        decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out decimal value)
            ? value
            : throw new FormatException($"\"{text}\" is not a decimal.");
}
