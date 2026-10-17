using System;

namespace ControlFlow;

/// <summary>An exception of the Fixture's own, carrying the value it rejected.</summary>
internal sealed class ValidationException : Exception
{
    public ValidationException(int value, string message)
        : base(message)
    {
        Value = value;
    }

    public int Value { get; }
}

/// <summary>Says when it is opened and when it is disposed.</summary>
internal sealed class Resource : IDisposable
{
    private readonly string name;

    public Resource(string name)
    {
        this.name = name;
        Console.WriteLine($"  open {name}");
    }

    public void Dispose() => Console.WriteLine($"  dispose {name}");
}

/// <summary>
/// try, catch, finally, filters, rethrow and using, each printing what ran in
/// what order. A case is a name, or a name and an operand: "divide:0".
/// </summary>
internal static class Exceptions
{
    public static void Run(string @case)
    {
        Console.WriteLine($"{@case}:");
        var colon = @case.IndexOf(':');
        var name = colon < 0 ? @case : @case.Substring(0, colon);
        var operand = colon < 0 ? null : @case.Substring(colon + 1);
        switch (name)
        {
            case "none":
                None();
                break;
            case "divide":
                Divide(Program.ParseInt32(Needs(name, operand)));
                break;
            case "parse":
                Parse(Needs(name, operand));
                break;
            case "validate":
                Validate(Program.ParseInt32(Needs(name, operand)));
                break;
            case "overflow":
                Overflow(Program.ParseInt32(Needs(name, operand)));
                break;
            case "rethrow":
                Rethrow();
                break;
            case "wrap":
                Wrap();
                break;
            case "filter":
                Filter();
                break;
            case "using":
                Using();
                break;
            case "return":
                Console.WriteLine($"  returned {ReturnFromTry()}");
                break;
            case "escape":
                Escape();
                break;
            default:
                throw new ArgumentException($"Unknown case \"{@case}\".");
        }
    }

    private static string Needs(string name, string? operand) =>
        operand ?? throw new ArgumentException($"Case \"{name}\" needs an operand.");

    private static void None()
    {
        try
        {
            Console.WriteLine("  try");
        }
        catch (Exception)
        {
            Console.WriteLine("  catch");
        }
        finally
        {
            Console.WriteLine("  finally");
        }
    }

    private static void Divide(int divisor)
    {
        try
        {
            Console.WriteLine($"  100 / {divisor} = {100 / divisor}");
        }
        catch (DivideByZeroException)
        {
            Console.WriteLine("  caught DivideByZeroException");
        }
        finally
        {
            Console.WriteLine("  finally");
        }
    }

    /// <summary>Which handler runs depends on the exception's type, and on filters.</summary>
    private static void Parse(string text)
    {
        try
        {
            Console.WriteLine($"  parsed {int.Parse(text, System.Globalization.CultureInfo.InvariantCulture)}");
        }
        catch (FormatException) when (text.Trim().Length == 0)
        {
            Console.WriteLine("  caught FormatException: blank");
        }
        catch (FormatException)
        {
            Console.WriteLine("  caught FormatException: not a number");
        }
        catch (OverflowException exception)
        {
            Console.WriteLine($"  caught {exception.GetType().Name}: too {(text.StartsWith('-') ? "small" : "big")}");
        }
    }

    private static void Validate(int value)
    {
        try
        {
            if (value < 0)
            {
                throw new ValidationException(value, "must not be negative");
            }

            if (value > 100)
            {
                throw new ValidationException(value, "must be at most 100");
            }

            Console.WriteLine($"  {value} is valid");
        }
        catch (ValidationException exception) when (exception.Value < 0)
        {
            Console.WriteLine($"  {exception.Value} is negative: {exception.Message}");
        }
        catch (ValidationException exception)
        {
            Console.WriteLine($"  {exception.Value} is too big: {exception.Message}");
        }
    }

    private static void Overflow(int addend)
    {
        try
        {
            var sum = checked(int.MaxValue - 10 + addend);
            Console.WriteLine($"  int.MaxValue - 10 + {addend} = {sum}");
        }
        catch (OverflowException)
        {
            Console.WriteLine($"  int.MaxValue - 10 + {addend} overflows");
        }
    }

    /// <summary>Inner handlers and finallys run before outer ones.</summary>
    private static void Rethrow()
    {
        try
        {
            try
            {
                throw new InvalidOperationException("inner");
            }
            catch (InvalidOperationException exception)
            {
                Console.WriteLine($"  inner catch: {exception.Message}");
                throw;
            }
            finally
            {
                Console.WriteLine("  inner finally");
            }
        }
        catch (InvalidOperationException exception)
        {
            Console.WriteLine($"  outer catch: {exception.Message}");
        }
        finally
        {
            Console.WriteLine("  outer finally");
        }
    }

    private static void Wrap()
    {
        try
        {
            try
            {
                throw new ValidationException(42, "the answer");
            }
            catch (ValidationException exception)
            {
                throw new InvalidOperationException("wrapped", exception);
            }
        }
        catch (InvalidOperationException exception)
        {
            Console.WriteLine($"  {exception.Message} <- {exception.InnerException?.GetType().Name}: {exception.InnerException?.Message}");
        }
    }

    /// <summary>
    /// A filter runs before the finally blocks between the throw and its
    /// handler: the runtime looks for a handler first, then unwinds. A filter
    /// turned into a catch that tests and rethrows would run after them.
    /// </summary>
    private static void Filter()
    {
        try
        {
            try
            {
                throw new InvalidOperationException("filtered");
            }
            finally
            {
                Console.WriteLine("  inner finally");
            }
        }
        catch (InvalidOperationException exception) when (Trace($"  filter sees {exception.Message}"))
        {
            Console.WriteLine("  caught");
        }
    }

    private static bool Trace(string message)
    {
        Console.WriteLine(message);
        return true;
    }

    /// <summary>Resources are disposed in reverse, before the handler runs.</summary>
    private static void Using()
    {
        try
        {
            using (var first = new Resource("first"))
            {
                using var second = new Resource("second");
                Console.WriteLine("  using both");
                throw new InvalidOperationException("thrown while using");
            }
        }
        catch (InvalidOperationException exception)
        {
            Console.WriteLine($"  caught: {exception.Message}");
        }
    }

    /// <summary>The value returned is read before the finally changes it.</summary>
    private static int ReturnFromTry()
    {
        var value = 1;
        try
        {
            return value;
        }
        finally
        {
            value = 2;
            Console.WriteLine($"  finally sets value = {value}");
        }
    }

    /// <summary>Nothing here handles it: the finally runs, then it escapes to Main.</summary>
    private static void Escape()
    {
        try
        {
            throw new NotSupportedException("nobody catches this");
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("  never printed");
        }
        finally
        {
            Console.WriteLine("  finally");
        }
    }
}
