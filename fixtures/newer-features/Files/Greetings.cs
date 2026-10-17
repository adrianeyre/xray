namespace NewerFeatures.Files;

/// <summary>Visible only in this file: Farewells.cs has a Format of its own.</summary>
file static class Format
{
    public static string Apply(string text) => $"<{text}>";
}

file interface IShout
{
    string Shout(string text);
}

file sealed class Shouter : IShout
{
    public string Shout(string text) => $"{text.ToUpperInvariant()}!";
}

public static class Greetings
{
    public static string Greet(string name) => Format.Apply($"hello, {new Shouter().Shout(name)}");

    public static System.Type FormatType => typeof(Format);

    public static System.Type ShouterType => typeof(Shouter);
}
