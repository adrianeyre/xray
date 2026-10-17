using System;
using System.Globalization;
using System.Linq;
using Gradebook;

namespace Net35Library;

/// <summary>
/// Keeps a year's marks in Gradebook, a .NET Framework 3.5 library, and
/// reports on them. It says which CLR the library was built for, and which
/// System.Core it references, so a Recovered Solution that built Gradebook for
/// another framework would behave differently.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int NotFound = 2;

    private const string Usage =
        "Usage: Net35Library <framework|report|forms|top|curve|student> [operands...]";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        var recorded = 0;
        var absent = 0;
        var book = new Book();
        book.MarkRecorded += (_, e) =>
        {
            recorded++;
            if (e.Mark is null)
            {
                absent++;
            }
        };
        Enrol(book);

        try
        {
            switch (args[0])
            {
                case "framework":
                    Framework();
                    return Succeeded;
                case "report":
                    Console.WriteLine($"Recorded {recorded} marks, {absent} absent.");
                    Report(book, Scheme(args));
                    return Succeeded;
                case "forms":
                    foreach (var line in book.FormReport(new LetterScheme()))
                    {
                        Console.WriteLine(line);
                    }
                    return Succeeded;
                case "top":
                    Top(book, int.Parse(Operand(args), CultureInfo.InvariantCulture));
                    return Succeeded;
                case "curve":
                    var points = int.Parse(Operand(args), CultureInfo.InvariantCulture);
                    foreach (var line in book.Curve(points, new LetterScheme()))
                    {
                        Console.WriteLine(line);
                    }
                    return Succeeded;
                case "student":
                    Describe(book.Find(Operand(args)));
                    return Succeeded;
                default:
                    Console.Error.WriteLine($"Unknown command \"{args[0]}\".");
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (FormatException)
        {
            Console.Error.WriteLine("Operands must be whole numbers.");
            return InvalidInput;
        }
        catch (ArgumentOutOfRangeException)
        {
            Console.Error.WriteLine("Counts and marks must stay in range.");
            return InvalidInput;
        }
        catch (GradebookException e)
        {
            Console.Error.WriteLine(e.Message);
            return NotFound;
        }
    }

    private static void Enrol(Book book)
    {
        book.Enrol("Eli", "7A");
        book.Enrol("Ada", "7A");
        book.Enrol("Cal", "7B");
        book.Enrol("Ben", "7A");
        book.Enrol("Dee", "7B");
        book.Record("Ada", 92, 88, 95);
        book.Record("Ben", 55, null, 61);
        book.Record("Cal", 40, 52, null, null);
        book.Record("dee", 84, 81, 78);
        book.Record("Eli", 85, 85);
    }

    private static string Operand(string[] args) =>
        args.Length > 1 ? args[1] : throw new FormatException();

    private static IGradingScheme Scheme(string[] args) =>
        args.Length > 1 && args[1] == "passfail"
            ? new PassFailScheme(new Percentage(500))
            : new LetterScheme();

    private static void Framework()
    {
        var library = typeof(Book).Assembly;
        var core = library.GetReferencedAssemblies().Single(name => name.Name == "System.Core");
        Console.WriteLine($"{library.GetName().Name}: CLR {library.ImageRuntimeVersion}, System.Core {core.Version}");
    }

    private static void Report(Book book, IGradingScheme scheme)
    {
        Console.WriteLine($"Grading: {scheme.Name}");
        foreach (var student in book.Students)
        {
            var average = student.Average();
            Console.WriteLine(
                $"{student.Name} ({student.Form}): {average} {scheme.Grade(average)} [{student.StandingOf()}]");
        }
    }

    private static void Top(Book book, int count)
    {
        var place = 0;
        foreach (var student in book.Students.Top(count, student => student.Average()))
        {
            Console.WriteLine($"{++place}. {student.Name} {student.Average()}");
        }
        if (place == 0)
        {
            Console.WriteLine("Nobody.");
        }
    }

    private static void Describe(Student student)
    {
        var average = student.Average();
        Console.WriteLine($"{student.Name} ({student.Form})");
        Console.WriteLine(
            "Marks: " + string.Join(", ", student.Marks.Select(mark => mark?.ToString() ?? "absent")));
        Console.WriteLine($"Average: {average} {new LetterScheme().Grade(average)}");
        Console.WriteLine($"Standing: {student.StandingOf()}");
    }
}
