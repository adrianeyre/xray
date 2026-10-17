using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;

namespace AsyncAwait;

/// <summary>
/// Runs async methods, lambdas and streams over its operands and prints what
/// they did, in the order they did it, and where each continuation ran. The
/// compiler turns each into a state machine, so a Recovered Solution that
/// resumed somewhere else, ran a <c>finally</c> at another time or lost an
/// exception behaves differently.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int Failed = 2;

    private const string Usage =
        "Usage: AsyncAwait <sum|interleave|totals|exceptions|fail|cancel|context|stream|dispose> [operands...]";

    private static async Task<int> Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it,
        // on whichever thread a continuation runs.
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            await Console.Error.WriteLineAsync(Usage);
            return InvalidInput;
        }

        int exitCode;
        try
        {
            // Everything runs on one thread, this one, but what is told not to.
            exitCode = SingleThreadContext.Run(context => RunAsync(context, args[0], args[1..]));
        }
        catch (FormatException exception)
        {
            await Console.Error.WriteLineAsync(exception.Message);
            return InvalidInput;
        }
        catch (InvalidOperationException exception)
        {
            await Console.Error.WriteLineAsync($"{exception.GetType().Name}: {exception.Message}");
            return Failed;
        }

        await Console.Out.FlushAsync();
        return exitCode;
    }

    private static async Task<int> RunAsync(SingleThreadContext context, string command, string[] operands)
    {
        switch (command)
        {
            case "sum":
                var log = new List<string>();
                var sum = await Basics.SumOfSquaresAsync(Ints(operands, 1), log);
                Print(log);
                Console.WriteLine($"the sum of their squares is {sum}");
                Console.WriteLine($"echoed: {await Basics.EchoAsync(sum)}, {await Basics.EchoAsync($"{operands[0]}!")}");
                break;
            case "interleave":
                await InterleaveAsync(Ints(operands, 2));
                break;
            case "totals":
                Print(await Basics.RunningTotalsAsync(Ints(operands, 1)));
                break;
            case "exceptions":
                Print(await Basics.ExceptionsAsync(context, Text(operands)));
                break;
            case "fail":
                Console.WriteLine("failing");
                await Basics.FailAsync(Text(operands), beforeAwait: false);
                Console.WriteLine("did not fail");
                break;
            case "cancel":
                var counts = Ints(operands, 2);
                Print(await Basics.CancelAsync(context, counts[0], counts[1]));
                break;
            case "context":
                Print(await Basics.ContextAsync(context));
                break;
            case "stream":
                Print(await Streams.ConsumeAsync(context, Ints(operands, 0)));
                Console.WriteLine($"and then: {Basics.Where(context)}");
                break;
            case "dispose":
                Print(await Streams.DisposeAsync(operands));
                break;
            default:
                Console.Error.WriteLine($"Unknown command \"{command}\".");
                Console.Error.WriteLine(Usage);
                return InvalidInput;
        }

        return Succeeded;
    }

    private static async Task InterleaveAsync(int[] steps)
    {
        var log = new List<string>();
        var first = Basics.WorkAsync("A", steps[0], log);
        var second = Basics.WorkAsync("B", steps[1], log);
        log.Add("both started");
        var results = await Task.WhenAll(first, second);
        log.Add($"results: {string.Join(", ", results)}");
        Print(log);
    }

    private static void Print(IEnumerable<string> lines)
    {
        foreach (var line in lines)
        {
            Console.WriteLine(line);
        }
    }

    private static string Text(string[] operands) =>
        operands.Length == 1 ? operands[0] : throw new FormatException("Give one word.");

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
