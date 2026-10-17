using System;
using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

namespace AsyncAwait;

/// <summary>
/// A SynchronizationContext that runs everything posted to it, one at a time
/// and in the order posted, on the thread that called <see cref="Run{T}"/>.
/// Continuations that resume on it therefore run in the same order every time,
/// which a thread pool does not promise; one that does not (after
/// <c>ConfigureAwait(false)</c>) shows it by running on another thread.
/// </summary>
internal sealed class SingleThreadContext : SynchronizationContext
{
    private readonly BlockingCollection<(SendOrPostCallback Callback, object? State)> queue = new();

    private SingleThreadContext()
    {
        ThreadId = Environment.CurrentManagedThreadId;
    }

    /// <summary>The thread everything posted to this context runs on.</summary>
    public int ThreadId { get; }

    /// <summary>Whether code is running on this context now, on its thread.</summary>
    public bool IsCurrent => Current == this && Environment.CurrentManagedThreadId == ThreadId;

    /// <summary>Runs <paramref name="work"/> on a new context until the task it returns is done.</summary>
    public static T Run<T>(Func<SingleThreadContext, Task<T>> work)
    {
        var previous = Current;
        var context = new SingleThreadContext();
        SetSynchronizationContext(context);
        try
        {
            var task = work(context);
            task.ContinueWith(_ => context.queue.CompleteAdding(), TaskScheduler.Default);
            foreach (var (callback, state) in context.queue.GetConsumingEnumerable())
            {
                callback(state);
            }

            return task.GetAwaiter().GetResult();
        }
        finally
        {
            SetSynchronizationContext(previous);
        }
    }

    public override void Post(SendOrPostCallback d, object? state) => queue.Add((d, state));

    public override void Send(SendOrPostCallback d, object? state) =>
        throw new NotSupportedException("Nothing here waits for another thread.");

    /// <summary>Awaits capture this context itself, never a copy.</summary>
    public override SynchronizationContext CreateCopy() => this;

    /// <summary>
    /// A task that completes once this context has run everything posted to it
    /// so far. Awaited on this context before it yields, it is never already
    /// complete, so the await always suspends. It runs its continuations
    /// asynchronously: on this context, if they captured it, otherwise on the
    /// thread pool, never inline on this context's thread.
    /// </summary>
    public Task Later()
    {
        var later = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Post(_ => later.SetResult(), null);
        return later.Task;
    }
}

/// <summary>An awaitable of its own, not a task: awaiting it always resumes on the thread pool.</summary>
internal readonly struct ToThreadPool
{
    public Awaiter GetAwaiter() => default;

    public readonly struct Awaiter : INotifyCompletion
    {
        public bool IsCompleted => false;

        public void OnCompleted(Action continuation) => ThreadPool.QueueUserWorkItem(_ => continuation());

        public void GetResult()
        {
        }
    }
}
