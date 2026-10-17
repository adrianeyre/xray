// Types for AssemblyDecompilerTests to find when it decompiles this assembly.

using System.Runtime.CompilerServices;

/// <summary>A type in the global namespace.</summary>
internal static class GlobalSubject
{
    public static int Answer() => 42;
}

namespace Xray.Engine.Tests.Subjects
{
    /// <summary>A type with a nested one, beside a generic type of the same name.</summary>
    public class Pair
    {
        public sealed class Inner
        {
        }
    }

    /// <summary>An array indexed from its end, which C# 8 writes <c>values[^1]</c> where the framework has System.Index.</summary>
    public static class IndexFromEnd
    {
        public static int Last(int[] values) => values[values.Length - 1];
    }

    /// <summary>A generic type, with nullable annotations.</summary>
    public class Pair<T>
    {
        public T? First { get; set; }

        public string? Label { get; set; }
    }

    /// <summary>Unsafe code: a fixed-size buffer, read through a pointer.</summary>
    public unsafe struct Buffer
    {
        private fixed byte bytes[4];

        public byte First()
        {
            fixed (byte* first = bytes)
            {
                return *first;
            }
        }
    }

    /// <summary>
    /// default(T) where the bare default literal would mean something else: in
    /// an interpolation hole, <c>default</c> is an object, so null, and prints
    /// nothing.
    /// </summary>
    public static class Defaults
    {
        public static string Interpolated() => $"[{default(Cell)}]";

        public struct Cell
        {
            public override readonly string ToString() => "cell";
        }
    }

    /// <summary>
    /// Type tests that compile only with an upcast to object, which IL does not
    /// record: a sealed class is never an interface it does not implement.
    /// </summary>
    public static class TypeTests
    {
        public static bool Is() => (object)new Sealed() is IUnrelated;

        public static IUnrelated? As(Sealed? left, Sealed right) => (object)(left ?? right) as IUnrelated;

        public static bool Related(object value) => value is IRelated;

        public static bool Unrelated(Unsealed value) => value is IUnrelated;

        public interface IRelated
        {
        }

        public interface IUnrelated
        {
        }

        public sealed class Sealed : IRelated
        {
        }

        /// <summary>Not sealed, so a class derived from it could be an IUnrelated.</summary>
        public class Unsealed
        {
        }
    }

    /// <summary>
    /// A lambda whose natural type is a delegate the compiler makes up, one C#
    /// could not declare: a parameter of a type parameter's type has a default.
    /// </summary>
    public static class AnonymousDelegates
    {
        public static int Scale(int value)
        {
            var scale = (int x, int by = 3) => x * by;
            return scale(value) + scale(value, 5);
        }
    }

    /// <summary>
    /// A switch expression that no arm of matches an unnamed value, so throws,
    /// through a helper the compiler adds to &lt;PrivateImplementationDetails&gt;.
    /// </summary>
    public static class Unmatched
    {
#pragma warning disable CS8524 // (DayOfWeek)7 matches no arm, which is the point.
        public static string Kind(DayOfWeek day) => day switch
        {
            DayOfWeek.Saturday or DayOfWeek.Sunday => "weekend",
            DayOfWeek.Monday or DayOfWeek.Tuesday or DayOfWeek.Wednesday or DayOfWeek.Thursday or DayOfWeek.Friday => "weekday",
        };
#pragma warning restore CS8524
    }

    /// <summary>A record copied by an empty with expression, which IL records as a call to its &lt;Clone&gt;$.</summary>
    public record Copied(int Value)
    {
        public Copied Copy() => this with { };
    }

    /// <summary>
    /// A record with an Equals and a GetHashCode of its own, which returns 0, as
    /// the compiler's would only for a record struct with no fields.
    /// </summary>
    public record Tolerant(double Value)
    {
        public virtual bool Equals(Tolerant? other) => other is not null && Math.Abs(Value - other.Value) < 1;

        public override int GetHashCode() => 0;
    }

    /// <summary>A primary constructor whose parameter only initializes a field, through a throw expression.</summary>
    public sealed class Checked(int value)
    {
        private readonly int positive = value > 0 ? value : throw new ArgumentOutOfRangeException(nameof(value));

        public int Positive => positive;
    }

    /// <summary>An iterator, an async method and an async iterator: each a state machine in IL.</summary>
    public static class StateMachines
    {
        public static IEnumerable<int> Countdown(int from)
        {
            while (from > 0)
            {
                yield return from--;
            }
        }

        public static async Task<int> DoubleAsync(int value)
        {
            await Task.Yield();
            return value * 2;
        }

        public static async IAsyncEnumerable<int> TicksAsync(int count, [EnumeratorCancellation] CancellationToken token = default)
        {
            for (var tick = 1; tick <= count; tick++)
            {
                await Task.Delay(0, token).ConfigureAwait(false);
                yield return tick;
            }
        }
    }

    /// <summary>
    /// An override calling its base class's method, a class of another assembly
    /// (ICSharpCode.Decompiler's), which the decompiler must find to know the
    /// call for <c>base.</c>, as a Form's <c>Dispose</c> calls its own.
    /// </summary>
    public sealed class BlockCounter : ICSharpCode.Decompiler.CSharp.Syntax.DepthFirstAstVisitor
    {
        public int Blocks { get; private set; }

        public override void VisitBlockStatement(ICSharpCode.Decompiler.CSharp.Syntax.BlockStatement blockStatement)
        {
            Blocks++;
            base.VisitBlockStatement(blockStatement);
        }
    }
}
