using System.Text.RegularExpressions;

namespace Lexicon;

/// <summary>A <c>[GeneratedRegex]</c> method in a readonly record struct.</summary>
internal readonly partial record struct Token(string Text)
{
    public string Kind => Number().IsMatch(Text) ? "number" : Word().IsMatch(Text) ? "word" : "symbol";

    [GeneratedRegex("^[0-9]+$")]
    private static partial Regex Number();

    [GeneratedRegex(@"^\p{L}+$")]
    private static partial Regex Word();
}
