using System;
using System.Collections.Immutable;
using System.CommandLine;
using System.Globalization;
using System.Linq;
using NuGet.Versioning;

namespace MicrosoftPackages;

/// <summary>
/// Compares, sorts and matches NuGet versions with NuGet.Versioning, keeps
/// them in System.Collections.Immutable's collections, and parses its command
/// line with System.CommandLine: code from three of Microsoft's packages that
/// .NET 8 does not provide, called, configured and extended.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidVersion = 2;

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

        var first = new Argument<string>("first") { Description = "A version." };
        var second = new Argument<string>("second") { Description = "Another version." };
        var compare = new Command("compare", "Compare two versions.") { first, second };
        compare.SetAction(result => Compare(result.GetValue(first)!, result.GetValue(second)!));

        var versions = new Argument<string[]>("versions") { Arity = ArgumentArity.OneOrMore, Description = "Versions." };
        var sort = new Command("sort", "Sort versions, once each, and group them by major version.") { versions };
        sort.SetAction(result => Sort(result.GetValue(versions)!));

        var range = new Argument<string>("range") { Description = "A version range, as NuGet writes one." };
        var prerelease = new Option<bool>("--prerelease", "-p") { Description = "Allow prerelease versions." };
        var best = new Command("best", "Find the lowest version a range allows.") { range, versions, prerelease };
        best.SetAction(result => Best(result.GetValue(range)!, result.GetValue(versions)!, result.GetValue(prerelease)));

        var root = new RootCommand("Compares, sorts and matches NuGet versions.") { compare, sort, best };
        return root.Parse(args).Invoke();
    }

    private static int Compare(string first, string second)
    {
        if (!TryParse(first, out var a) || !TryParse(second, out var b))
        {
            return InvalidVersion;
        }

        var order = VersionComparer.Default.Compare(a, b);
        var sign = order < 0 ? "<" : order > 0 ? ">" : "==";
        Console.WriteLine($"{a.ToNormalizedString()} {sign} {b.ToNormalizedString()}");
        Console.WriteLine($"{a.ToFullString()}: {Describe(a)}");
        Console.WriteLine($"{b.ToFullString()}: {Describe(b)}");
        return Succeeded;
    }

    private static int Sort(string[] texts)
    {
        var parsed = ImmutableArray.CreateBuilder<NuGetVersion>(texts.Length);
        foreach (var text in texts)
        {
            if (!TryParse(text, out var version))
            {
                return InvalidVersion;
            }

            parsed.Add(version);
        }

        var sorted = ImmutableSortedSet.CreateRange(VersionComparer.VersionRelease, parsed.ToImmutable());
        Console.WriteLine($"{sorted.Count} of {texts.Length}: {string.Join(", ", sorted.Select(v => v.ToNormalizedString()))}");

        var byMajor = sorted
            .GroupBy(version => version.Major)
            .ToImmutableSortedDictionary(group => group.Key, group => group.ToImmutableList());
        foreach (var (major, inMajor) in byMajor)
        {
            Console.WriteLine($"{major}.x: {inMajor.Count}, latest {inMajor[^1].ToNormalizedString()}");
        }

        var stable = sorted.Where(version => !version.IsPrerelease).ToImmutableHashSet();
        Console.WriteLine(stable.IsEmpty ? "No stable version." : $"Highest stable: {stable.Max()!.ToNormalizedString()}");
        return Succeeded;
    }

    private static int Best(string text, string[] texts, bool allowPrerelease)
    {
        if (!VersionRange.TryParse(text, out var range))
        {
            Console.Error.WriteLine($"Not a version range: {text}");
            return InvalidVersion;
        }

        var candidates = ImmutableList.CreateBuilder<NuGetVersion>();
        foreach (var candidate in texts)
        {
            if (!TryParse(candidate, out var version))
            {
                return InvalidVersion;
            }

            if (allowPrerelease || !version.IsPrerelease)
            {
                candidates.Add(version);
            }
        }

        Console.WriteLine($"{range.PrettyPrint()}: {range.ToNormalizedString()}");
        var match = range.FindBestMatch(candidates.ToImmutable());
        Console.WriteLine(match is null ? "No version satisfies it." : $"Best: {match.ToNormalizedString()}");
        return Succeeded;
    }

    private static string Describe(NuGetVersion version) =>
        version switch
        {
            { IsPrerelease: true } => $"prerelease ({string.Join(".", version.ReleaseLabels)})",
            { HasMetadata: true } => $"stable, built {version.Metadata}",
            { IsLegacyVersion: true } => "stable, four-part",
            _ => "stable",
        };

    private static bool TryParse(string text, out NuGetVersion version)
    {
        if (NuGetVersion.TryParse(text, out var parsed))
        {
            version = parsed;
            return true;
        }

        Console.Error.WriteLine($"Not a version: {text}");
        version = null!;
        return false;
    }
}
