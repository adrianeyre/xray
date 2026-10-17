using System.Globalization;
using System.Text;

namespace Phrasebook;

/// <summary>Text as ASCII, so output is the same on every OS and console.</summary>
internal static class Text
{
    /// <summary><c>Café\r\n</c> → <c>Caf\u00E9\r\n</c>, with the control characters spelled out.</summary>
    public static string Escape(string text)
    {
        var escaped = new StringBuilder();
        foreach (var c in text)
        {
            escaped.Append(c switch
            {
                '\r' => "\\r",
                '\n' => "\\n",
                '\t' => "\\t",
                '\\' => "\\\\",
                // Not $"\\u{(int)c:X4}": ICSharpCode.Decompiler 11.1 leaves that
                // cast out, and a char ignores its format.
                < ' ' or > '~' => "\\u" + ((int)c).ToString("X4", CultureInfo.InvariantCulture),
                _ => c.ToString(),
            });
        }

        return escaped.ToString();
    }
}
