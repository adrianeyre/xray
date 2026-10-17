using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using Generics.Variance;

namespace Generics.Collections;

/// <summary>A stack of any type, enumerated top first by a struct enumerator of its own.</summary>
public sealed class ArrayStack<T> : IEnumerable<T>
{
    private T[] items = new T[2];
    private int count;

    public int Count => count;

    public void Push(T item)
    {
        if (count == items.Length)
        {
            Array.Resize(ref items, count * 2);
        }

        items[count++] = item;
    }

    public T Pop()
    {
        if (count == 0)
        {
            throw new InvalidOperationException("The stack is empty.");
        }

        var item = items[--count];
        items[count] = default!;
        return item;
    }

    public bool TryPeek([MaybeNullWhen(false)] out T item)
    {
        if (count == 0)
        {
            item = default;
            return false;
        }

        item = items[count - 1];
        return true;
    }

    /// <summary>A stack of what each item transforms to, in the same order.</summary>
    public ArrayStack<TResult> ConvertAll<TResult>(Transform<T, TResult> transform)
    {
        var result = new ArrayStack<TResult>();
        for (var i = 0; i < count; i++)
        {
            result.Push(transform(items[i]));
        }

        return result;
    }

    public Enumerator GetEnumerator() => new(this);

    IEnumerator<T> IEnumerable<T>.GetEnumerator() => GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    public struct Enumerator : IEnumerator<T>
    {
        private readonly ArrayStack<T> stack;
        private int index;

        internal Enumerator(ArrayStack<T> stack)
        {
            this.stack = stack;
            index = stack.count;
        }

        public readonly T Current => stack.items[index];

        readonly object? IEnumerator.Current => Current;

        public bool MoveNext() => --index >= 0;

        public void Reset() => index = stack.count;

        public readonly void Dispose()
        {
        }
    }
}
