using System;
using System.Runtime.CompilerServices;
using Generics.Collections;

namespace Generics;

/// <summary>Generic methods, each with a different kind of constraint, whose type arguments are mostly inferred.</summary>
public static class Algorithms
{
    /// <summary>The greatest item; the first of those that tie.</summary>
    public static T Max<T>(T first, params T[] rest)
        where T : IComparable<T>
    {
        var max = first;
        foreach (var item in rest)
        {
            if (item.CompareTo(max) > 0)
            {
                max = item;
            }
        }

        return max;
    }

    public static void Swap<T>(ref T left, ref T right)
    {
        var swapped = left;
        left = right;
        right = swapped;
    }

    /// <summary>A new T, which runs a struct's parameterless constructor where default(T) would not.</summary>
    public static T Make<T>()
        where T : new() => new T();

    public static T? TopOrNull<T>(ArrayStack<T> stack)
        where T : class => stack.TryPeek(out var top) ? top : null;

    public static T OrDefault<T>(T? value)
        where T : struct => value ?? default(T);

    public static int SizeOf<T>()
        where T : unmanaged => Unsafe.SizeOf<T>();

    public static TBase Upcast<TDerived, TBase>(TDerived value)
        where TDerived : TBase => value;

    public static string NameOf<TEnum>(TEnum value)
        where TEnum : struct, Enum => Enum.GetName(value) ?? $"no {typeof(TEnum).Name} is {value}";

    /// <summary>The type it was called with, which may be more than the value's own, and the value.</summary>
    public static string Describe<T>(T value) => $"{Program.TypeName(typeof(T))} {value?.ToString() ?? "null"}";
}

/// <summary>A struct whose parameterless constructor starts it at 1.</summary>
public struct Tally
{
    public Tally()
    {
        Value = 1;
    }

    public int Value { get; set; }

    public override readonly string ToString() => $"tally {Value}";
}
