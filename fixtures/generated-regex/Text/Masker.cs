using System.Text.RegularExpressions;

namespace Lexicon.Text;

/// <summary>An instance <c>[GeneratedRegex]</c> method, beside a class's other members.</summary>
internal sealed partial class Masker(char mask)
{
    public string Mask(string word) => Vowels().Replace(word, mask.ToString());

    [GeneratedRegex("[aeiou]", RegexOptions.IgnoreCase)]
    private partial Regex Vowels();
}
