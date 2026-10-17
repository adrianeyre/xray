using System;
using System.Collections.Generic;
using System.Text;

namespace ControlFlow;

/// <summary>Each kind of loop C# has, with break, continue and goto.</summary>
internal static class Loops
{
    public static void Run(int n)
    {
        Console.WriteLine($"n = {n}");
        Console.WriteLine($"  for: {Triangle(n)}");
        Console.WriteLine($"  while: {Collatz(n)}");
        Console.WriteLine($"  do-while: {Reversed(n)}");
        Console.WriteLine($"  foreach: {OddSquares(n)}");
        Console.WriteLine($"  goto: {Factor(n)}");
        Console.WriteLine($"  for (two variables): {Converge(n)}");
    }

    private static string Triangle(int n)
    {
        long sum = 0;
        for (var i = 1; i <= n; i++)
        {
            sum += i;
        }

        return $"1 + ... + {n} = {sum}";
    }

    private static string Collatz(int n)
    {
        if (n < 1)
        {
            return $"collatz({n}) is not defined";
        }

        long value = n;
        var steps = 0;
        while (value != 1)
        {
            value = value % 2 == 0 ? value / 2 : 3 * value + 1;
            steps++;
        }

        return $"collatz({n}) reaches 1 in {steps} steps";
    }

    /// <summary>A do-while runs its body once even for 0, which has one digit.</summary>
    private static string Reversed(int n)
    {
        long value = Math.Abs((long)n);
        var digits = new StringBuilder();
        do
        {
            digits.Append((char)('0' + value % 10));
            value /= 10;
        }
        while (value != 0);

        return $"{n} reversed is {(n < 0 ? "-" : "")}{digits}";
    }

    /// <summary>The odd squares below n, but no more than five of them.</summary>
    private static string OddSquares(int n)
    {
        var numbers = new int[50];
        for (var i = 0; i < numbers.Length; i++)
        {
            numbers[i] = i + 1;
        }

        var squares = new List<int>();
        foreach (var number in numbers)
        {
            if (number % 2 == 0)
            {
                continue;
            }

            var square = number * number;
            if (square >= n)
            {
                break;
            }

            squares.Add(square);
            if (squares.Count == 5)
            {
                break;
            }
        }

        return squares.Count == 0 ? $"no odd squares below {n}" : $"odd squares below {n}: {string.Join(", ", squares)}";
    }

    /// <summary>The smallest factor pair, found by jumping out of two loops at once.</summary>
    private static string Factor(int n)
    {
        if (n < 2)
        {
            return $"{n} has no factors to find";
        }

        int i, j;
        for (i = 2; i <= n / i; i++)
        {
            for (j = i; j <= n / i; j++)
            {
                if (i * j == n)
                {
                    goto Found;
                }
            }
        }

        return $"{n} is prime";

    Found:
        return $"{n} = {i} * {n / i}";
    }

    private static string Converge(int n)
    {
        int low, high;
        var steps = 0;
        for (low = 0, high = n; low < high; low++, high--)
        {
            steps++;
        }

        return $"0 and {n} meet after {steps} steps, at {low} and {high}";
    }
}
