using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

namespace Fixtures.Pointers.Text;

/// <summary>A name and, if known, the full name it stands for.</summary>
public sealed record Entry(string Key, string? FullName);

/// <summary>
/// Names, looked up through members whose nullable annotations are part of
/// their public signature, which <see cref="Nullability"/> reads back.
/// </summary>
public sealed class Directory
{
    private readonly Dictionary<string, Entry> entries = new();

    public Directory(params (string Key, string? FullName)[] entries)
    {
        foreach (var (key, fullName) in entries)
        {
            this.entries[key] = new Entry(key, fullName);
        }
    }

    /// <summary>The entry most recently found, if any.</summary>
    public Entry? LastFound { get; private set; }

    public string Name { get; set; } = "people";

    public bool TryFind(string key, [NotNullWhen(true)] out Entry? entry)
    {
        if (entries.TryGetValue(key, out entry))
        {
            LastFound = entry;
            return true;
        }

        return false;
    }

    public Entry? Find(string key) => TryFind(key, out var entry) ? entry : null;

    public T FirstOr<T>(IEnumerable<T> values, T fallback)
        where T : notnull
    {
        foreach (var value in values)
        {
            return value;
        }

        return fallback;
    }

    public List<string?> FullNames()
    {
        var names = new List<string?>();
        foreach (var entry in entries.Values)
        {
            names.Add(entry.FullName);
        }

        return names;
    }
}
