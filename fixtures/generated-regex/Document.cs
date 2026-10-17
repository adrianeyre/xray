using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Lexicon;

/// <summary>A <c>[GeneratedRegex]</c> method in a type nested in a generic one, each declared partial.</summary>
internal partial class Document<T>(T title)
{
    public T Title { get; } = title;

    public IReadOnlyList<string> Words(string text) => Splitter.Words(text);

    internal static partial class Splitter
    {
        public static IReadOnlyList<string> Words(string text)
        {
            var words = new List<string>();
            foreach (var part in Separator().Split(text))
            {
                if (part.Length > 0)
                {
                    words.Add(part);
                }
            }

            return words;
        }

        [GeneratedRegex(@"[\s,;.!?]+")]
        private static partial Regex Separator();
    }
}
