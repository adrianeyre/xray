using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Runtime.CompilerServices;
using RecordsPatterns.Records;
using RecordsPatterns.Shapes;

namespace RecordsPatterns;

/// <summary>
/// Puts its operands through records and patterns and prints what they did.
/// The compiler writes a record's equality, printing, copying and
/// deconstruction itself, and lowers each pattern to branches; the Fixture
/// also reads back by reflection which members a record has and which
/// setters are init-only, so a Recovered Solution that turned a record into
/// a class, or an init into a set, describes itself differently.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int Failed = 2;

    private const string Usage =
        "Usage: RecordsPatterns <points|money|people|tags|temperatures|endpoint|members|shapes|numbers|words|characters|weather|order|inspect|suits> [operands...]";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        var operands = args[1..];
        try
        {
            switch (args[0])
            {
                case "points":
                    var coordinates = Ints(operands, 4);
                    Points(new Point(coordinates[0], coordinates[1]), new Point(coordinates[2], coordinates[3]));
                    break;
                case "money":
                    Money(operands);
                    break;
                case "people":
                    if (operands.Length != 3)
                    {
                        throw new FormatException("Usage: RecordsPatterns people <name> <level> <reports>");
                    }

                    var numbers = Ints(operands[1..], 2);
                    People(operands[0], numbers[0], numbers[1]);
                    break;
                case "tags":
                    Tags(operands);
                    break;
                case "temperatures":
                    Temperatures(Doubles(operands));
                    break;
                case "endpoint":
                    Endpoint(operands);
                    break;
                case "members":
                    Members();
                    break;
                case "shapes":
                    foreach (var shape in operands)
                    {
                        Console.WriteLine($"{shape}: {ShapeDescriber.Describe(ShapeDescriber.Parse(shape))}");
                    }

                    break;
                case "numbers":
                    Numbers(Ints(operands, 0));
                    break;
                case "words":
                    foreach (var word in operands)
                    {
                        Console.WriteLine($"[{word}]: {Patterns.Word(word)}; quoted: {Patterns.IsQuoted(word)}");
                    }

                    break;
                case "characters":
                    foreach (var c in string.Join(" ", operands))
                    {
                        Console.WriteLine($"'{c}': {Patterns.Character(c)}");
                    }

                    break;
                case "weather":
                    foreach (var celsius in Doubles(operands))
                    {
                        Console.WriteLine($"{celsius}: {Patterns.Weather(celsius)}");
                    }

                    break;
                case "order":
                    Order(operands);
                    break;
                case "inspect":
                    Inspect(operands);
                    break;
                case "suits":
                    foreach (var suit in Ints(operands, 0))
                    {
                        Console.WriteLine($"{(Suit)suit}: {Patterns.Colour((Suit)suit)}");
                    }

                    break;
                default:
                    Console.Error.WriteLine($"Unknown command \"{args[0]}\".");
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (FormatException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return InvalidInput;
        }
        catch (SwitchExpressionException exception)
        {
            Console.Error.WriteLine($"No arm matched {exception.UnmatchedValue}.");
            return Failed;
        }
        catch (InvalidOperationException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return Failed;
        }

        return Succeeded;
    }

    private static void Points(Point first, Point second)
    {
        Console.WriteLine($"{first} and {second}");
        Console.WriteLine($"equal: {first == second}, by Equals: {first.Equals(second)}, same hash: {first.GetHashCode() == second.GetHashCode()}");

        var moved = first with { X = first.X + 10 };
        Console.WriteLine($"{moved}, leaving {first}");

        // A record struct is copied, so translating the copy leaves the original.
        var copy = first;
        copy.Translate(1);
        Console.WriteLine($"translated copy {copy}, original {first}");

        var (x, y) = second;
        Console.WriteLine($"deconstructed: x {x}, y {y}, {second.ManhattanLength} blocks away");
    }

    private static void Money(string[] operands)
    {
        if (operands.Length != 4)
        {
            throw new FormatException("Usage: RecordsPatterns money <amount> <currency> <amount> <currency>");
        }

        var first = new Money(Decimal(operands[0]), operands[1]);
        var second = new Money(Decimal(operands[2]), operands[3]);
        Console.WriteLine($"{first} and {second}: equal {first == second}");
        Console.WriteLine($"in euros: {first with { Currency = "EUR" }}");
        Console.WriteLine($"sum: {first + second}");
    }

    private static void People(string name, int level, int reports)
    {
        var employee = new Employee(name, level);
        var manager = new Manager(name, level, reports);
        Console.WriteLine(employee);
        Console.WriteLine(manager);
        Console.WriteLine($"{employee.Grade}; same employee: {employee == new Employee(name, level)}; employee and manager equal: {employee == manager}, as Employees: {employee.Equals((Employee)manager)}");

        // A copy made through the base type is still a Manager.
        Person promoted = manager with { Level = level + 1 };
        Console.WriteLine($"promoted: {promoted.GetType().Name} {promoted}");

        var (managerName, managerLevel, managerReports) = manager;
        Console.WriteLine($"deconstructed: {managerName}, level {managerLevel}, {managerReports} reports");

        // Arrays are compared by reference, and a copy shares the original's.
        var tagged = employee with { Tags = new[] { "remote" } };
        var alike = employee with { Tags = new[] { "remote" } };
        Console.WriteLine($"tagged alike: {tagged == alike}; a copy of tagged: {tagged == tagged with { }}");
    }

    private static void Tags(string[] names)
    {
        foreach (var name in names)
        {
            var tag = new Tag(name);
            tag.Deconstruct(out var deconstructed);
            Console.WriteLine($"[{name}]: {tag}, deconstructed [{deconstructed}], equal to the tag \"{deconstructed}\": {tag == new Tag(deconstructed)}");
        }
    }

    private static void Temperatures(double[] values)
    {
        // Kept apart only by the record's own Equals and GetHashCode.
        var distinct = new HashSet<Temperature>();
        for (var i = 0; i < values.Length; i++)
        {
            var current = new Temperature(values[i]);
            distinct.Add(current);
            if (i > 0)
            {
                var previous = new Temperature(values[i - 1]);
                Console.WriteLine($"{previous} and {current}: equal {previous == current}, warmer {current with { Celsius = current.Celsius + 1 }}");
            }
        }

        Console.WriteLine($"{distinct.Count} distinct of {values.Length}");
    }

    private static void Endpoint(string[] operands)
    {
        Console.WriteLine($"default: {new Endpoint()}");
        if (operands.Length != 2)
        {
            throw new FormatException("Usage: RecordsPatterns endpoint <host> <port>");
        }

        var port = Ints(operands[1..], 1)[0];
        var endpoint = new Endpoint { Host = operands[0], Port = port };
        endpoint.Secure = port == 443;
        Console.WriteLine($"given: {endpoint}");
    }

    /// <summary>What each type declares: its properties' accessors, then its methods.</summary>
    private static void Members()
    {
        foreach (var type in new[] { typeof(Point), typeof(Money), typeof(Person), typeof(Employee), typeof(Manager), typeof(Tag), typeof(Temperature), typeof(Endpoint) })
        {
            const BindingFlags declared = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
            var properties = new List<string>();
            foreach (var property in type.GetProperties(declared))
            {
                properties.Add($"{property.Name} {Accessors(property)}");
            }

            var methods = new List<string>();
            foreach (var method in type.GetMethods(declared))
            {
                if (!method.IsSpecialName)
                {
                    methods.Add($"{(method.IsVirtual ? "virtual " : "")}{method.Name}({method.GetParameters().Length})");
                }
            }

            properties.Sort(StringComparer.Ordinal);
            methods.Sort(StringComparer.Ordinal);
            Console.WriteLine($"{(type.IsValueType ? "struct" : type.IsSealed ? "sealed class" : type.IsAbstract ? "abstract class" : "class")} {type.Name}");
            Console.WriteLine($"  properties: {string.Join(", ", properties)}");
            Console.WriteLine($"  methods: {string.Join(", ", methods)}");
        }
    }

    private static string Accessors(PropertyInfo property)
    {
        if (property.SetMethod is not { } setter)
        {
            return "{ get; }";
        }

        foreach (var modifier in setter.ReturnParameter.GetRequiredCustomModifiers())
        {
            if (modifier == typeof(IsExternalInit))
            {
                return "{ get; init; }";
            }
        }

        return "{ get; set; }";
    }

    private static void Numbers(int[] numbers)
    {
        foreach (var number in numbers)
        {
            Console.WriteLine($"{number}: {Patterns.Size(number)}, {Patterns.FizzBuzz(number)}, {Patterns.Positive(number)}");
        }

        Console.WriteLine($"as an array: {Patterns.List(numbers)}");
        Console.WriteLine($"as a list: {Patterns.Prefix(new List<int>(numbers))}");
    }

    private static void Order(string[] operands)
    {
        if (operands.Length != 4)
        {
            throw new FormatException("Usage: RecordsPatterns order <city|-> <country> <total> <items>");
        }

        var address = operands[0] == "-" ? null : new Address(operands[0], operands[1]);
        var order = new Order(new Customer("Sam", address), Decimal(operands[2]), Ints(operands[3..], 1)[0]);
        Console.WriteLine($"{order}: {Patterns.Shipping(order)}");
    }

    private static void Inspect(string[] operands)
    {
        var values = new List<object?>
        {
            null,
            7L,
            (short)3,
            new Point(0, 0),
            new Point(3, 3),
            new Point(1, -4),
            new[] { 4, 5, 6, 7, 8 },
            new int[0],
            new List<int> { 1 },
            2.5,
            Suit.Hearts,
        };
        foreach (var operand in operands)
        {
            values.Add(int.TryParse(operand, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : operand);
        }

        foreach (var value in values)
        {
            Console.WriteLine($"{Patterns.Inspect(value)}; {Patterns.Positive(value)}");
        }
    }

    private static int[] Ints(string[] operands, int count)
    {
        if (count > 0 && operands.Length != count)
        {
            throw new FormatException($"Give {count} ints.");
        }

        var numbers = new int[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            numbers[i] = int.TryParse(operands[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
                ? value
                : throw new FormatException($"\"{operands[i]}\" is not an int.");
        }

        return numbers;
    }

    private static double[] Doubles(string[] operands)
    {
        var numbers = new double[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            numbers[i] = double.TryParse(operands[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
                ? value
                : throw new FormatException($"\"{operands[i]}\" is not a number.");
        }

        return numbers;
    }

    private static decimal Decimal(string text) =>
        decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? value
            : throw new FormatException($"\"{text}\" is not an amount.");
}
