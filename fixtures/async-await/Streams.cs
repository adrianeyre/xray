using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

namespace AsyncAwait;

/// <summary>
/// Async streams: async iterators, consumed with <c>await foreach</c>, given a
/// cancellation token through <c>[EnumeratorCancellation]</c>, and resumed off
/// the context with <c>ConfigureAwait(false)</c>; and async disposal with
/// <c>await using</c>. What runs when shows in a log.
/// </summary>
internal static class Streams
{
    public static async IAsyncEnumerable<int> EvensAsync(
        int[] values,
        List<string> log,
        [EnumeratorCancellation] CancellationToken token = default)
    {
        log.Add("evens started");
        try
        {
            foreach (var value in values)
            {
                token.ThrowIfCancellationRequested();
                await Task.Yield();
                if (value % 2 == 0)
                {
                    log.Add($"yielding {value}");
                    yield return value;
                }
            }
        }
        finally
        {
            log.Add("evens finally");
        }
    }

    /// <summary>One async stream over another, awaiting as it maps each value.</summary>
    public static async IAsyncEnumerable<TResult> SelectAsync<T, TResult>(IAsyncEnumerable<T> source, Func<T, Task<TResult>> map)
    {
        await foreach (var value in source)
        {
            yield return await map(value);
        }
    }

    /// <summary>Counts to <paramref name="count"/>, resuming off the context before each value.</summary>
    public static async IAsyncEnumerable<int> TicksAsync(SingleThreadContext context, int count)
    {
        for (var tick = 1; tick <= count; tick++)
        {
            await context.Later().ConfigureAwait(false);
            yield return tick;
        }
    }

    public static async Task<List<string>> ConsumeAsync(SingleThreadContext context, int[] values)
    {
        var log = new List<string>();
        var all = new List<int>();
        await foreach (var value in EvensAsync(values, log))
        {
            all.Add(value);
        }

        log.Add($"all evens: [{string.Join(", ", all)}]");

        await foreach (var value in EvensAsync(values, log))
        {
            log.Add($"took {value}, then broke off");
            break;
        }

        await foreach (var text in SelectAsync(EvensAsync(values, log), async value =>
        {
            await Task.Yield();
            return $"<{value / 2}>";
        }))
        {
            log.Add($"mapped to {text}");
        }

        using var source = new CancellationTokenSource();
        try
        {
            await foreach (var value in EvensAsync(values, log).WithCancellation(source.Token))
            {
                log.Add($"took {value}, then cancelled");
                source.Cancel();
            }

            log.Add("never cancelled");
        }
        catch (OperationCanceledException exception)
        {
            log.Add($"{exception.GetType().Name} from the stream");
        }

        await foreach (var tick in TicksAsync(context, 2))
        {
            log.Add($"tick {tick}: {Basics.Where(context)}");
        }

        await foreach (var tick in TicksAsync(context, 2).ConfigureAwait(false))
        {
            log.Add($"tick {tick} with ConfigureAwait(false): {Basics.Where(context)}");
        }

        return log;
    }

    /// <summary>Async disposal, in both forms of <c>await using</c>, and by hand.</summary>
    public static async Task<List<string>> DisposeAsync(string[] names)
    {
        var log = new List<string>();
        await using (var first = new Resource("first", log))
        {
            await first.UseAsync();
        }

        foreach (var name in names)
        {
            await using var resource = new Resource(name, log);
            await resource.UseAsync();
            if (name == "stop")
            {
                log.Add("stopping early");
                break;
            }
        }

        var enumerator = EvensAsync([2, 3, 4], log).GetAsyncEnumerator();
        try
        {
            while (await enumerator.MoveNextAsync())
            {
                log.Add($"moved to {enumerator.Current}");
            }
        }
        finally
        {
            await enumerator.DisposeAsync();
        }

        return log;
    }
}

/// <summary>Disposed asynchronously, saying so.</summary>
internal sealed class Resource(string name, List<string> log) : IAsyncDisposable
{
    private bool disposed;

    public async Task UseAsync()
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        await Task.Yield();
        log.Add($"used {name}");
    }

    public async ValueTask DisposeAsync()
    {
        await Task.Yield();
        disposed = true;
        log.Add($"disposed {name}");
    }
}
