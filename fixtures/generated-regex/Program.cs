using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using Lexicon.Text;

namespace Lexicon;

/// <summary>
/// Puts its operands through regular expressions the regex source generator
/// implements, and prints what they matched. It reads back by reflection how
/// each was declared and what the generator made of it, so a Recovered
/// Solution that implemented one itself, or constructed it at runtime, rather
/// than leave it to the generator, describes itself differently.
/// </summary>
internal static partial class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;

    private const string Usage =
        "Usage: Lexicon <identifiers|numbers|dates|greetings|cultures|vowels|words|tokens|regexes> [operands...]";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0 || !Command().IsMatch(args[0]))
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        var operands = args[1..];
        switch (args[0])
        {
            case "identifiers":
                foreach (var operand in operands)
                {
                    Console.WriteLine($"{operand}: {(Patterns.Identifier().IsMatch(operand) ? "an identifier" : "not an identifier")}");
                }

                break;
            case "numbers":
                Numbers(string.Join(" ", operands));
                break;
            case "dates":
                var text = string.Join(" ", operands);
                Console.WriteLine(Patterns.IsoDate().Replace(text, "${day}/${month}/${year}"));
                foreach (Match date in Patterns.IsoDate().Matches(text))
                {
                    Console.WriteLine($"year {date.Groups["year"].Value}, month {date.Groups["month"].Value}, day {date.Groups["day"].Value} at {date.Index}");
                }

                break;
            case "greetings":
                foreach (var operand in operands)
                {
                    var greeting = Patterns.Greeting().Match(operand);
                    Console.WriteLine(greeting.Success ? $"{operand}: greets with \"{greeting.Value}\" at {greeting.Index}" : $"{operand}: no greeting");
                }

                break;
            case "cultures":
                Cultures();
                break;
            case "vowels":
                var masker = new Masker('*');
                foreach (var operand in operands)
                {
                    Console.WriteLine($"{operand} -> {masker.Mask(operand)}");
                }

                break;
            case "words":
                var document = new Document<int>(operands.Length);
                var words = document.Words(string.Join(" ", operands));
                Console.WriteLine($"{words.Count} words in {document.Title} operands: [{string.Join("|", words)}]");
                break;
            case "tokens":
                foreach (var operand in operands)
                {
                    var token = new Token(operand);
                    Console.WriteLine($"{token}: {token.Kind}");
                }

                break;
            case "regexes":
                Regexes();
                break;
            default:
                Console.Error.WriteLine($"Unknown command \"{args[0]}\".");
                Console.Error.WriteLine(Usage);
                return InvalidInput;
        }

        return Succeeded;
    }

    [GeneratedRegex("^[a-z]+$")]
    private static partial Regex Command();

    private static void Numbers(string text)
    {
        var numbers = Patterns.Number().Matches(text);
        var sum = 0L;
        var found = new List<string>();
        foreach (Match number in numbers)
        {
            sum += long.Parse(number.Value, CultureInfo.InvariantCulture);
            found.Add(number.Value);
        }

        Console.WriteLine($"{numbers.Count} numbers: [{string.Join(", ", found)}], summing to {sum}");
        var last = Patterns.LastDigit().Match(text);
        Console.WriteLine(last.Success ? $"last digit: {last.Value} at {last.Index}" : "no digit");
    }

    /// <summary>
    /// Which of I, dotted I, i and dotless i each case-insensitive i matches:
    /// in Turkish, and in no culture. Named by code point, so the output stays ASCII.
    /// </summary>
    private static void Cultures()
    {
        foreach (var codePoint in new[] { 0x49, 0x130, 0x69, 0x131 })
        {
            var text = ((char)codePoint).ToString();
            Console.WriteLine($"U+{codePoint:X4}: Turkish {Patterns.TurkishI().IsMatch(text)}, invariant {Patterns.InvariantI().IsMatch(text)}");
        }
    }

    /// <summary>
    /// How each <c>[GeneratedRegex]</c> method was declared, as its attributes
    /// say, and what it returns: a Regex of the generator's, which it declares
    /// file-scoped in a file of its own and names after the method, or one it
    /// constructs at runtime, where it writes no code of its own.
    /// </summary>
    private static void Regexes()
    {
        var declaring = new (string Name, Type Type, object? Instance)[]
        {
            ("Program", typeof(Program), null),
            ("Patterns", typeof(Patterns), null),
            ("Masker", typeof(Masker), new Masker('#')),
            ("Document<T>.Splitter", typeof(Document<string>.Splitter), null),
            ("Token", typeof(Token), null),
        };
        foreach (var (name, type, instance) in declaring)
        {
            var methods = new List<MethodInfo>();
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                if (method.GetCustomAttribute<GeneratedRegexAttribute>() is not null)
                {
                    methods.Add(method);
                }
            }

            methods.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
            foreach (var method in methods)
            {
                var attribute = method.GetCustomAttribute<GeneratedRegexAttribute>()!;
                var regex = (Regex)method.Invoke(method.IsStatic ? null : instance, null)!;
                var timeout = regex.MatchTimeout == Regex.InfiniteMatchTimeout ? "none" : $"{regex.MatchTimeout.TotalMilliseconds} ms";
                Console.WriteLine($"{name}.{method.Name}: \"{attribute.Pattern}\", {attribute.Options}, culture \"{attribute.CultureName}\", timeout {timeout}");
                Console.WriteLine($"  {(method.IsPublic ? "public" : "not public")}, {(method.IsStatic ? "static" : "instance")}, implemented by {method.GetCustomAttribute<GeneratedCodeAttribute>()?.Tool ?? "nothing generated"}");
                Console.WriteLine($"  returns {Kind(regex.GetType())}, the same each time: {ReferenceEquals(regex, method.Invoke(method.IsStatic ? null : instance, null))}");
            }
        }
    }

    /// <summary>
    /// What a Regex is: the generator names its own after the method, numbered
    /// (Number_1), and declares it file-scoped, which names it after its file
    /// too, and a checksum of its path: &lt;RegexGenerator_g&gt;F1A2B…__Number_1.
    /// The number is left out: the generator numbers them in the order it
    /// finds them, which is the order of the files declaring them.
    /// </summary>
    private static string Kind(Type type)
    {
        var match = GeneratedName().Match(type.Name);
        return match.Success
            ? $"{match.Groups["name"].Value}, scoped to {match.Groups["file"].Value}, in {type.Namespace}, a {type.BaseType?.Name}"
            : $"a {type.Name} constructed at runtime";
    }

    [GeneratedRegex("^<(?<file>[^>]+)>F[0-9A-F]{64}__(?<name>.+)_[0-9]+$")]
    private static partial Regex GeneratedName();
}
