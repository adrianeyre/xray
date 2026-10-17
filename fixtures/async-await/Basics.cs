using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace AsyncAwait;

/// <summary>
/// Async methods, lambdas and local functions, and the order their code runs
/// in: an async method runs synchronously up to its first await of something
/// not yet complete, and its exceptions wait in its task until it is awaited.
/// </summary>
internal static class Basics
{
    /// <summary>Completes synchronously for an even value, asynchronously for an odd one.</summary>
    public static async ValueTask<int> SquareAsync(int value)
    {
        if (value % 2 == 0)
        {
            return value * value;
        }

        await Task.Yield();
        return value * value;
    }

    public static async Task<int> SumOfSquaresAsync(int[] values, List<string> log)
    {
        var total = 0;
        foreach (var value in values)
        {
            var square = SquareAsync(value);
            log.Add($"square of {value} already complete: {square.IsCompleted}");
            total += await square;
        }

        return total;
    }

    public static async Task<T> EchoAsync<T>(T value)
    {
        await Task.Yield();
        return value;
    }

    /// <summary>Logs each step, yielding to the other workers between them.</summary>
    public static async Task<string> WorkAsync(string name, int steps, List<string> log)
    {
        for (var step = 1; step <= steps; step++)
        {
            log.Add($"{name} step {step}");
            await Task.Yield();
        }

        log.Add($"{name} done");
        return $"{name}x{steps}";
    }

    /// <summary>An async lambda and an async local function, both over a captured total.</summary>
    public static async Task<List<string>> RunningTotalsAsync(int[] values)
    {
        var log = new List<string>();
        var total = 0;
        Func<int, Task<int>> addLater = async value =>
        {
            await Task.Yield();
            total += value;
            return total;
        };

        async Task<string> DescribeAsync(int value)
        {
            var running = await addLater(value);
            return $"+{value} = {running}";
        }

        var started = values.Select(DescribeAsync).ToList();
        log.Add($"{started.Count} started; the total is still {total}");
        log.AddRange(await Task.WhenAll(started));
        log.Add($"the total is {total}");
        return log;
    }

    /// <summary>Throws before its first await, or after it: either way, into its task.</summary>
    public static async Task FailAsync(string message, bool beforeAwait)
    {
        if (beforeAwait)
        {
            throw new InvalidOperationException(message);
        }

        await Task.Yield();
        throw new InvalidOperationException(message);
    }

    public static async Task<List<string>> ExceptionsAsync(SingleThreadContext context, string message)
    {
        var log = new List<string>();
        var early = FailAsync($"{message} early", beforeAwait: true);
        var late = FailAsync($"{message} late", beforeAwait: false);
        log.Add($"neither call threw; faulted already: {early.IsFaulted}, {late.IsFaulted}");

        try
        {
            await late;
            log.Add("awaiting it did not throw");
        }
        catch (InvalidOperationException exception) when (exception.Message.EndsWith("late"))
        {
            log.Add($"caught \"{exception.Message}\"");
            await context.Later();
            log.Add($"awaited in catch, back on the context: {context.IsCurrent}");
        }
        finally
        {
            await Task.Yield();
            log.Add("awaited in finally");
        }

        var both = Task.WhenAll(early, FailAsync($"{message} again", beforeAwait: false));
        try
        {
            await both;
        }
        catch (InvalidOperationException exception)
        {
            log.Add($"awaiting both threw the first: \"{exception.Message}\"; the task holds {both.Exception?.InnerExceptions.Count} exceptions");
        }

        return log;
    }

    /// <summary>Counts to <paramref name="steps"/>, cancelling itself at <paramref name="cancelAt"/>.</summary>
    public static async Task<int> CountAsync(int steps, int cancelAt, CancellationTokenSource source, List<string> log)
    {
        var count = 0;
        for (var step = 1; step <= steps; step++)
        {
            if (step == cancelAt)
            {
                source.Cancel();
            }

            source.Token.ThrowIfCancellationRequested();
            count++;
            log.Add($"counted {count}");
            await Task.Yield();
        }

        return count;
    }

    public static async Task<List<string>> CancelAsync(SingleThreadContext context, int steps, int cancelAt)
    {
        var log = new List<string>();
        using var source = new CancellationTokenSource();
        var counting = CountAsync(steps, cancelAt, source, log);
        try
        {
            log.Add($"counted to {await counting}");
        }
        catch (OperationCanceledException exception)
        {
            log.Add($"{exception.GetType().Name}; the count is {counting.Status}, for the source's token: {exception.CancellationToken == source.Token}");
        }

        using var later = new CancellationTokenSource();
        var forever = Task.Delay(Timeout.Infinite, later.Token);
        context.Post(_ => later.Cancel(), null);
        try
        {
            await forever;
        }
        catch (TaskCanceledException exception)
        {
            log.Add($"an endless delay ended in {exception.GetType().Name}, {forever.Status}");
        }

        return log;
    }

    /// <summary>Where each continuation runs: on the context it captured, or, with ConfigureAwait(false), not.</summary>
    public static async Task<List<string>> ContextAsync(SingleThreadContext context)
    {
        var log = new List<string>();
        log.Add($"before any await: {Where(context)}");
        await context.Later();
        log.Add($"after an await: {Where(context)}");
        await context.Later().ConfigureAwait(true);
        log.Add($"after ConfigureAwait(true): {Where(context)}");
        await Task.CompletedTask.ConfigureAwait(false);
        log.Add($"after ConfigureAwait(false) on a completed task: {Where(context)}");
        log.Add($"inside a method that used ConfigureAwait(false): {await OffTheContextAsync(context)}");
        log.Add($"back in its caller: {Where(context)}");
        log.Add($"inside a method that awaited the thread pool: {await OnThreadPoolAsync(context)}");
        log.Add($"back in its caller: {Where(context)}");
        var square = await SquareAsync(3).ConfigureAwait(true);
        log.Add($"after ConfigureAwait(true) on a ValueTask of {square}: {Where(context)}");
        return log;
    }

    private static async Task<string> OffTheContextAsync(SingleThreadContext context)
    {
        await context.Later().ConfigureAwait(false);
        return Where(context);
    }

    private static async Task<string> OnThreadPoolAsync(SingleThreadContext context)
    {
        await new ToThreadPool();
        return Where(context);
    }

    public static string Where(SingleThreadContext context) =>
        context.IsCurrent
            ? "on the context"
            : $"off the context, {(SynchronizationContext.Current is null ? "with none" : "with another")}, {(Environment.CurrentManagedThreadId == context.ThreadId ? "on its thread" : "on another thread")}";
}
