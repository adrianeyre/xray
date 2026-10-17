using System;
using System.Globalization;

namespace ControlFlow;

/// <summary>
/// Runs its operands through loops, switch statements or exception handlers
/// and prints what each one did. The operands come from the command line, so
/// the compiler cannot fold the control flow away: the Assembly carries it as
/// branches, jump tables and exception-handling clauses.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int Failed = 2;

    private const string Usage = "Usage: ControlFlow <loops|switch|exceptions> [operands...]";

    private static int Main(string[] args)
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
                case "loops":
                    for (var i = 1; i < args.Length; i++)
                    {
                        Loops.Run(ParseInt32(args[i]));
                    }

                    return Succeeded;
                case "switch":
                    for (var i = 1; i < args.Length; i++)
                    {
                        Switches.Run(args[i]);
                    }

                    return Succeeded;
                case "exceptions":
                    for (var i = 1; i < args.Length; i++)
                    {
                        Exceptions.Run(args[i]);
                    }

                    return Succeeded;
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
            return InvalidInput;
        }
        catch (NotSupportedException exception)
        {
            // Escaped every handler on the way up.
            Console.Error.WriteLine($"Unhandled {exception.GetType().Name}: {exception.Message}");
            return Failed;
        }
    }

    internal static int ParseInt32(string text) =>
        int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out int value)
            ? value
            : throw new FormatException($"\"{text}\" is not an int.");
}
