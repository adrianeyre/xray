using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Resources;
using Phrasebook.Phrases;

namespace Phrasebook;

/// <summary>
/// Reads back every kind of resource its Assembly embeds, and those of its
/// satellite assemblies: strings by culture, falling back to the neutral ones;
/// a byte[] and a stream from a .resx; files embedded as they are; and an int
/// and a bool from a .resources file. A Recovered Solution that lost or renamed
/// any of them, or a satellite assembly, prints something else.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int NotFound = 2;

    private const string Usage =
        "Usage: Phrasebook <manifest|say|welcome|menu|file|image|anthem|limits> [operands...]";

    private static readonly ResourceManager Strings = new("Phrasebook.Strings", typeof(Program).Assembly);
    private static readonly ResourceManager Images = new("Phrasebook.Images", typeof(Program).Assembly);
    private static readonly ResourceManager Limits = new("Phrasebook.Limits", typeof(Program).Assembly);

    private static int Main(string[] args)
    {
        // Resources are looked up for the culture asked for, never the machine's.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        try
        {
            return args[0] switch
            {
                "manifest" => Manifest(),
                "say" => Say(args),
                "welcome" => Welcome(args),
                "menu" => PrintMenu(args),
                "file" => PrintFile(args),
                "image" => Image(),
                "anthem" => Anthem(),
                "limits" => PrintLimits(),
                _ => Unknown(args[0]),
            };
        }
        catch (CultureNotFoundException)
        {
            Console.Error.WriteLine($"Unknown culture \"{args[^1]}\".");
            return InvalidInput;
        }
    }

    private static int Unknown(string command)
    {
        Console.Error.WriteLine($"Unknown command \"{command}\".");
        Console.Error.WriteLine(Usage);
        return InvalidInput;
    }

    /// <summary>Every resource the Assembly, and each satellite assembly, embeds, by name.</summary>
    private static int Manifest()
    {
        var assembly = typeof(Program).Assembly;
        Console.WriteLine($"{assembly.GetName().Name} {assembly.GetName().Version}:");
        PrintNames(assembly);
        foreach (var name in new[] { "de", "es", "fr" })
        {
            var culture = CultureInfo.GetCultureInfo(name);
            Assembly satellite;
            try
            {
                satellite = assembly.GetSatelliteAssembly(culture);
            }
            catch (FileNotFoundException)
            {
                Console.WriteLine($"[{name}] no satellite assembly");
                continue;
            }

            var identity = satellite.GetName();
            Console.WriteLine($"[{name}] {identity.Name} {identity.Version} {identity.CultureName}:");
            PrintNames(satellite);
        }

        return Succeeded;
    }

    private static void PrintNames(Assembly assembly)
    {
        foreach (var name in assembly.GetManifestResourceNames().OrderBy(name => name, StringComparer.Ordinal))
        {
            using var stream = assembly.GetManifestResourceStream(name)!;
            Console.WriteLine($"  {name} ({stream.Length} bytes)");
        }
    }

    private static int Say(string[] args)
    {
        if (args.Length is < 2 or > 3)
        {
            Console.Error.WriteLine("Usage: Phrasebook say <phrase> [culture]");
            return InvalidInput;
        }

        var culture = args.Length == 3 ? CultureInfo.GetCultureInfo(args[2]) : CultureInfo.InvariantCulture;
        var phrase = Strings.GetString(args[1], culture);
        if (phrase is null)
        {
            Console.Error.WriteLine($"No phrase \"{args[1]}\".");
            return NotFound;
        }

        Console.WriteLine($"{args[1]} = {Text.Escape(phrase)}");
        return Succeeded;
    }

    private static int Welcome(string[] args)
    {
        if (args.Length is < 3 or > 4 || !int.TryParse(args[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var count))
        {
            Console.Error.WriteLine("Usage: Phrasebook welcome <name> <count> [culture]");
            return InvalidInput;
        }

        var culture = args.Length == 4 ? CultureInfo.GetCultureInfo(args[3]) : CultureInfo.InvariantCulture;
        var format = Strings.GetString("Welcome", culture)!;
        Console.WriteLine(Text.Escape(string.Format(CultureInfo.InvariantCulture, format, args[1], count)));
        return Succeeded;
    }

    private static int PrintMenu(string[] args)
    {
        var culture = args.Length > 1 ? CultureInfo.GetCultureInfo(args[1]) : CultureInfo.InvariantCulture;
        foreach (var item in Menu.Items)
        {
            Console.WriteLine($"{item}: {Text.Escape(Menu.Name(item, culture))}");
        }

        return Succeeded;
    }

    /// <summary>A text file embedded as it is, by its logical name, from the Assembly or a satellite.</summary>
    private static int PrintFile(string[] args)
    {
        if (args.Length is < 2 or > 3)
        {
            Console.Error.WriteLine("Usage: Phrasebook file <name> [culture]");
            return InvalidInput;
        }

        var assembly = typeof(Program).Assembly;
        if (args.Length == 3)
        {
            assembly = assembly.GetSatelliteAssembly(CultureInfo.GetCultureInfo(args[2]));
        }

        using var stream = assembly.GetManifestResourceStream(args[1]);
        if (stream is null)
        {
            Console.Error.WriteLine($"No file \"{args[1]}\".");
            return NotFound;
        }

        using var reader = new StreamReader(stream);
        foreach (var line in reader.ReadToEnd().Split('\n'))
        {
            Console.WriteLine($"| {Text.Escape(line)}");
        }

        return Succeeded;
    }

    /// <summary>The flag, embedded as a file and as a byte[] in Images.resx: the same PNG.</summary>
    private static int Image()
    {
        using var stream = typeof(Program).Assembly.GetManifestResourceStream("Phrasebook.Assets.flag.png")!;
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        var embedded = copy.ToArray();
        var fromResx = (byte[])Images.GetObject("Flag", CultureInfo.InvariantCulture)!;

        Console.WriteLine($"file: {Png.Describe(embedded)}");
        Console.WriteLine($"resx: {Png.Describe(fromResx)}");
        Console.WriteLine($"same: {embedded.SequenceEqual(fromResx)}");
        Console.WriteLine($"caption: {Images.GetString("Caption", CultureInfo.InvariantCulture)}");
        return Succeeded;
    }

    /// <summary>A stream in Images.resx.</summary>
    private static int Anthem()
    {
        using var stream = Images.GetStream("Anthem", CultureInfo.InvariantCulture)!;
        using var reader = new StreamReader(stream);
        Console.WriteLine($"{stream.Length} bytes:");
        foreach (var line in reader.ReadToEnd().TrimEnd('\n').Split('\n'))
        {
            Console.WriteLine($"| {Text.Escape(line)}");
        }

        return Succeeded;
    }

    /// <summary>An int and a bool, kept as they are in a .resources file, and a string beside them.</summary>
    private static int PrintLimits()
    {
        foreach (var name in new[] { "MaxPhrases", "Strict", "Motto", "Missing" })
        {
            var value = Limits.GetObject(name, CultureInfo.InvariantCulture);
            Console.WriteLine(value is null ? $"{name}: none" : $"{name}: {value} ({value.GetType().FullName})");
        }

        return Succeeded;
    }
}
