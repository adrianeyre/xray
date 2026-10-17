using System;
using System.Collections.Generic;

namespace ClosuresLinq;

/// <summary>
/// Lambdas and local functions, and what they capture: a variable, not its
/// value, so a lambda sees every later change to it, and two lambdas over the
/// same variable share it. Which variable a lambda gets — one per loop, or one
/// per iteration — shows in what it prints.
/// </summary>
internal static class Closures
{
    /// <summary>Two delegates sharing one captured variable.</summary>
    public static (Func<int> Next, Action<int> Reset) Counter(int start)
    {
        var count = start;
        return (() => ++count, value => count = value);
    }

    /// <summary>A lambda over a parameter changed after the lambda was made sees the change.</summary>
    public static Func<int, int> Adder(int amount)
    {
        Func<int, int> add = value => value + amount;
        amount *= 10;
        return add;
    }

    /// <summary>
    /// A <c>for</c> loop has one variable for every iteration, so each lambda
    /// sees its last value; <c>foreach</c>, and a copy taken in the body, give
    /// each iteration a variable of its own.
    /// </summary>
    public static IEnumerable<string> Loops(int[] values)
    {
        var shared = new List<Func<int>>();
        for (var i = 0; i < values.Length; i++)
        {
            shared.Add(() => i);
        }

        var copied = new List<Func<int>>();
        for (var i = 0; i < values.Length; i++)
        {
            var copy = i;
            copied.Add(() => copy);
        }

        var each = new List<Func<int>>();
        foreach (var value in values)
        {
            each.Add(() => value);
        }

        yield return $"for, captured: [{string.Join(", ", Invoke(shared))}]";
        yield return $"for, copied: [{string.Join(", ", Invoke(copied))}]";
        yield return $"foreach: [{string.Join(", ", Invoke(each))}]";
    }

    private static List<int> Invoke(List<Func<int>> functions) => functions.ConvertAll(function => function());

    /// <summary>
    /// Scopes nested inside one another, each with a variable captured from
    /// inside it and from the scope around it: the compiler gives each scope a
    /// closure class of its own, the inner holding the outer.
    /// </summary>
    public static List<string> Nested(int[] values)
    {
        var log = new List<string>();
        var total = 0;
        var actions = new List<Action>();
        foreach (var value in values)
        {
            var running = 0;
            for (var step = 1; step <= 2; step++)
            {
                var factor = step;
                actions.Add(() =>
                {
                    running += value * factor;
                    total += value * factor;
                    log.Add($"{value}x{factor}: running {running}, total {total}");
                });
            }
        }

        foreach (var action in actions)
        {
            action();
        }

        // Run again: each scope's variables kept their values.
        actions[0]();
        return log;
    }

    /// <summary>
    /// Local functions: one that captures (through a struct, as it is never a
    /// delegate), one that recurses, a static one that cannot capture, and one
    /// turned into a delegate.
    /// </summary>
    public static IEnumerable<string> LocalFunctions(int n)
    {
        var calls = 0;
        int Factorial(int k)
        {
            calls++;
            return k <= 1 ? 1 : k * Factorial(k - 1);
        }

        static int Square(int k) => k * k;

        var offset = n;
        int Shift(int k) => k + offset;
        Func<int, int> shift = Shift;

        yield return $"{n}! = {Factorial(n)} in {calls} calls";
        yield return $"{n} squared is {Square(n)}";
        offset = 100;
        yield return $"shifted by the offset now: {shift(n)}, {Shift(1)}";
    }

    /// <summary>
    /// Delegates combined and removed: each runs in the order it was added, and
    /// removing one takes its last occurrence.
    /// </summary>
    public static List<string> Multicast(string[] names)
    {
        var log = new List<string>();
        Action<string>? all = null;
        var each = new List<Action<string>>();
        foreach (var name in names)
        {
            Action<string> greet = text => log.Add($"{name} hears {text}");
            each.Add(greet);
            all += greet;
        }

        all?.Invoke("one");
        if (each.Count > 0)
        {
            all += each[0];
            all -= each[0];
            all -= each[^1];
        }

        all?.Invoke("two");
        log.Add($"{all?.GetInvocationList().Length ?? 0} left");
        return log;
    }

    /// <summary>
    /// A lambda with a default parameter (C# 12), a static lambda, method groups
    /// (static, instance and extension), and a closure over <c>this</c>.
    /// </summary>
    public static IEnumerable<string> Kinds(int n)
    {
        var scale = (int value, int by = 3) => value * by;
        Func<int, int> twice = static value => value * 2;
        Func<string, int> parse = int.Parse;
        var tally = new Tally();
        var text = $"n{n}";
        Func<string> describe = text.Describe;
        Action<int> add = tally.Adder();

        yield return $"scale({n}) = {scale(n)}, scale({n}, 5) = {scale(n, 5)}";
        yield return $"twice({n}) = {twice(n)}, parse(\"{n}0\") = {parse($"{n}0")}";
        yield return describe();
        add(n);
        add(n);
        yield return $"tally {tally.Total} after adding {n} twice";
    }
}

/// <summary>A class whose lambda captures <c>this</c>.</summary>
internal sealed class Tally
{
    public int Total { get; private set; }

    public Action<int> Adder() => value => Total += value;
}

internal static class Texts
{
    public static string Describe(this string text) => $"\"{text}\" has {text.Length} characters";
}
