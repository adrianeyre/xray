namespace NewerFeatures.Files;

/// <summary>Visible only in this file: Greetings.cs has a Format of its own.</summary>
file static class Format
{
    public static string Apply(string text) => $"[{text}]";
}

public static class Farewells
{
    public static string Part(string name) => Format.Apply($"goodbye, {name}");

    public static System.Type FormatType => typeof(Format);
}
