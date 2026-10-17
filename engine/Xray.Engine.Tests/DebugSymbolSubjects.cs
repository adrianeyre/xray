// Types for DebugSymbolsTests to find in this assembly's PDB, declared in one file.

namespace Xray.Engine.Tests.Subjects
{
    /// <summary>A local whose name only the PDB records: without it, the decompiler calls it <c>num</c>.</summary>
    public static class Tally
    {
        public static int Sum(int[] values)
        {
            var runningTotal = 0;
            foreach (var value in values)
            {
                runningTotal += value;
            }

            return runningTotal;
        }
    }

    /// <summary>
    /// A partial type, most of whose own methods are declared here, though
    /// DebugSymbolSubjects.Lambdas.cs holds more code: the lambdas in its
    /// nested <c>&lt;&gt;c</c>.
    /// </summary>
    public static partial class Halves
    {
        public static int First(int[] values) => values[0];

        public static int Last(int[] values) => values[^1];
    }

    /// <summary>A type with no code of its own, whose file only the PDB's type documents record.</summary>
    public interface ICounted
    {
        int Count { get; }
    }
}

namespace Xray.Engine.Tests.Other
{
    /// <summary>A type of another namespace in the same file.</summary>
    public sealed class Neighbour
    {
        public string Greet(string name)
        {
            var greeting = $"Hello, {name}";
            return $"{greeting} ({greeting.Length})";
        }
    }
}
