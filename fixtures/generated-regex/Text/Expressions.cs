using System.Text.RegularExpressions;

namespace Lexicon.Text;

/// <summary>
/// Regular expressions and nothing else: every method here is one the regex
/// source generator implements, in a file of its own, so the PDB records no
/// code in this file, only that the type was declared in it, which is not
/// named after it.
/// </summary>
internal static partial class Patterns
{
    [GeneratedRegex("^[A-Za-z_][A-Za-z_0-9]*$")]
    public static partial Regex Identifier();

    /// <summary>With a culture and a timeout, which the generated Regex keeps.</summary>
    [GeneratedRegex(@"-?\d+", RegexOptions.CultureInvariant, 1000, "en-US")]
    public static partial Regex Number();

    [GeneratedRegex(@"\d", RegexOptions.RightToLeft)]
    public static partial Regex LastDigit();

    [GeneratedRegex(@"\b(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})\b")]
    public static partial Regex IsoDate();

    /// <summary>
    /// One the generator writes no matching code for, but a Regex constructed
    /// once, at runtime: it cannot for NonBacktracking.
    /// </summary>
    [GeneratedRegex("hel+o", RegexOptions.IgnoreCase | RegexOptions.NonBacktracking)]
    public static partial Regex Greeting();

    /// <summary>In Turkish, a dotted I is the capital of i, and a dotless i the small I.</summary>
    [GeneratedRegex("^i$", RegexOptions.IgnoreCase, "tr-TR")]
    public static partial Regex TurkishI();

    [GeneratedRegex("^i$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    public static partial Regex InvariantI();
}
