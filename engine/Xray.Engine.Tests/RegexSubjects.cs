// [GeneratedRegex] methods for AssemblyDecompilerTests and DebugSymbolsTests,
// which the regex source generator implements in RegexGenerator.g.cs.

using System.Text.RegularExpressions;

namespace Xray.Engine.Tests.Subjects;

/// <summary>Regular expressions and nothing else: the PDB records no code in this file.</summary>
public static partial class Regexes
{
    [GeneratedRegex("^[a-z]+$", RegexOptions.IgnoreCase, 1000)]
    public static partial Regex Word();

    /// <summary>One the generator writes no matching code for, but a Regex it constructs at runtime.</summary>
    [GeneratedRegex("hel+o", RegexOptions.NonBacktracking)]
    internal static partial Regex Greeting();

    /// <summary>A nested type with no code but what the generator wrote either.</summary>
    public static partial class Spacing
    {
        [GeneratedRegex(@"\s+")]
        public static partial Regex Space();
    }
}

/// <summary>An instance <c>[GeneratedRegex]</c> method, in a type nested in a generic one.</summary>
public partial class RegexHolder<T>
{
    public sealed partial class Nested
    {
        public bool HasDigit(string text) => Digit().IsMatch(text);

        [GeneratedRegex(@"\d")]
        private partial Regex Digit();
    }
}
