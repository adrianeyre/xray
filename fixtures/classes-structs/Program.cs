using System;
using System.Collections.Generic;
using System.Globalization;
using ClassesStructs.Shapes;
using ClassesStructs.Values;

namespace ClassesStructs;

/// <summary>
/// Makes shapes, points, counters, a thermostat and a grid from its operands
/// and prints what they do. Which method runs, what a constructor sees and
/// whether a struct was copied all show in the output, so a Recovered
/// Solution that changed any of them behaves differently.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;

    private const string Usage =
        "Usage: ClassesStructs <shapes|dispatch|construct|points|structs|thermostat|grid> [operands...]";

    private static readonly Counter Frozen = new(1);

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        try
        {
            switch (args[0])
            {
                case "shapes":
                    Shapes(args);
                    break;
                case "dispatch":
                    Dispatch();
                    break;
                case "construct":
                    Construct();
                    break;
                case "points":
                    Points(args);
                    break;
                case "structs":
                    Structs();
                    break;
                case "thermostat":
                    Heat(args);
                    break;
                case "grid":
                    Mark(args);
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

        return Succeeded;
    }

    private static void Shapes(string[] args)
    {
        var shapes = new List<Shape>();
        for (var i = 1; i < args.Length; i++)
        {
            shapes.Add(ParseShape(args[i]));
        }

        foreach (IShape shape in shapes)
        {
            Console.WriteLine($"{shape}: {shape.Describe()}");
        }

        // By area, through Shape's explicit IComparable<Shape>.
        shapes.Sort();
        Console.WriteLine($"by area: {string.Join(", ", shapes)}");
        foreach (var shape in shapes)
        {
            Console.WriteLine(shape is IScalable scalable
                ? $"{shape} doubled: {scalable.Scale(2).Describe()}"
                : $"{shape} cannot be scaled");
        }

        Console.WriteLine($"{Shape.Created} shapes made");
    }

    private static void Dispatch()
    {
        var square = new Square(3);
        Rectangle rectangle = square;
        IShape shape = square;
        Console.WriteLine($"through Square: {square.Describe()}");
        Console.WriteLine($"through Rectangle: {rectangle.Describe()}");
        Console.WriteLine($"through IShape: {shape.Describe()}");
        IShape triangle = new Triangle(2, 2, 2);
        Console.WriteLine($"a triangle through IShape: {triangle.Describe()}");
        Console.WriteLine($"{square} is a Shape: {square is Shape}, an IScalable: {square is IScalable}; {triangle} is an IScalable: {triangle is IScalable}");
    }

    private static void Construct()
    {
        Console.WriteLine("new Derived():");
        var derived = new Derived();
        Console.WriteLine("new MostDerived():");
        Base mostDerived = new MostDerived();
        Base asBase = derived;
        Console.WriteLine($"Greet through Base: {asBase.Greet()}, through Derived: {derived.Greet()}");
        Console.WriteLine($"Describe through Base: {mostDerived.Describe()}");
    }

    private static void Points(string[] args)
    {
        if (args.Length != 3)
        {
            throw new FormatException("Usage: ClassesStructs points <x,y> <x,y>");
        }

        var a = (Point)args[1];
        var b = (Point)args[2];
        Console.WriteLine($"a = {a}, b = {b}");
        Console.WriteLine($"a + b = {a + b}");
        Console.WriteLine($"a - b = {a - b}");
        Console.WriteLine($"-a = {-a}");
        Console.WriteLine($"a * 3 = {a * 3}");
        Console.WriteLine($"a == b is {a == b}, a != b is {a != b}, a.Equals((object)b) is {a.Equals((object)b)}");
        Console.WriteLine($"a == Origin is {a == Point.Origin}, |a| = {a.ManhattanLength}");
        object box = a;
        object again = a;
        Console.WriteLine($"two boxes of a: the same object is {ReferenceEquals(box, again)}, equal is {box.Equals(again)}");
    }

    private static void Structs()
    {
        var a = new Counter();
        Console.WriteLine($"new Counter() is {a}, default(Counter) is {default(Counter)}, new Counter[1][0] is {(new Counter[1])[0]}, new Counter(5) is {new Counter(5)}");

        var b = a;
        b.Increment();
        Console.WriteLine($"after b = a; b.Increment(): a is {a}, b is {b}");

        ICounter box = a;
        box.Increment();
        box.Increment();
        Console.WriteLine($"after boxing a and incrementing it twice: a is {a}, the box is {box}");

        var array = new[] { new Counter(1), new Counter(1) };
        array[0].Increment();
        Console.WriteLine($"after array[0].Increment(): array[0] is {array[0]}, array[1] is {array[1]}");

        var list = new List<Counter> { new(1) };
        list[0].Increment();
        Console.WriteLine($"after list[0].Increment(): list[0] is {list[0]}");

        Bump(ref a);
        Console.WriteLine($"after Bump(ref a): a is {a}");
        Ignore(a);
        Console.WriteLine($"after Ignore(a): a is {a}");

        Frozen.Increment();
        Console.WriteLine($"after Frozen.Increment() on a readonly field: Frozen is {Frozen}");

        Console.WriteLine($"two circles of radius 1 are equal: {new Circle(1).Equals(new Circle(1))}; two points (1, 2) are equal: {new Point(1, 2).Equals(new Point(1, 2))}");
    }

    private static void Bump(ref Counter counter) => counter.Increment();

    private static void Ignore(Counter counter) => counter.Increment();

    private static void Heat(string[] args)
    {
        var thermostat = new Thermostat();
        thermostat.Changed += OnChanged;
        thermostat.Alarm += OnAlarm;
        for (var i = 1; i < args.Length; i++)
        {
            Console.WriteLine($"set to {args[i]}");
            thermostat.Temperature = ParseInt32(args[i]);
        }

        thermostat.Alarm -= OnAlarm;
        Console.WriteLine($"set to {Thermostat.Limit + 10}");
        thermostat.Temperature = Thermostat.Limit + 10;
        thermostat.Changed -= OnChanged;
        Console.WriteLine("set to 0");
        thermostat.Temperature = 0;
        Console.WriteLine($"ends at {thermostat.Temperature}");
    }

    private static void OnChanged(object? sender, TemperatureChangedEventArgs change) =>
        Console.WriteLine($"  changed from {change.From} to {change.To}");

    private static void OnAlarm(string message) => Console.WriteLine($"  ALARM: {message}");

    private static void Mark(string[] args)
    {
        if (args.Length < 3)
        {
            throw new FormatException("Usage: ClassesStructs grid <width> <height> [x,y...]");
        }

        var grid = new Grid(ParseInt32(args[1]), ParseInt32(args[2]));
        var mark = 'a';
        for (var i = 3; i < args.Length; i++)
        {
            var point = (Point)args[i];
            if (!grid.Contains(point))
            {
                Console.WriteLine($"{point} is outside the grid");
            }
            else if (grid[point] != '.')
            {
                Console.WriteLine($"{point} is already marked {grid[point]}");
            }
            else
            {
                grid[point] = mark++;
            }
        }

        for (var y = 0; y < grid.Height; y++)
        {
            Console.WriteLine(grid.Row(y));
        }

        Console.WriteLine($"{new Grid.Cursor(grid).Marked} of {grid.Width * grid.Height} cells marked, the first is {grid[0, 0]}");
    }

    private static Shape ParseShape(string spec)
    {
        var colon = spec.IndexOf(':');
        var size = colon < 0 ? "" : spec.Substring(colon + 1);
        switch (colon < 0 ? spec : spec.Substring(0, colon))
        {
            case "circle":
                return new Circle(ParsePositive(size));
            case "rect":
                var sides = size.Split('x');
                if (sides.Length == 2)
                {
                    return new Rectangle(ParsePositive(sides[0]), ParsePositive(sides[1]));
                }

                break;
            case "square":
                return new Square(ParsePositive(size));
            case "triangle":
                var lengths = size.Split(',');
                if (lengths.Length == 3)
                {
                    return new Triangle(ParsePositive(lengths[0]), ParsePositive(lengths[1]), ParsePositive(lengths[2]));
                }

                break;
        }

        throw new FormatException($"\"{spec}\" is not a shape.");
    }

    private static double ParsePositive(string text) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double value) && value > 0
            ? value
            : throw new FormatException($"\"{text}\" is not a positive number.");

    private static int ParseInt32(string text) =>
        int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out int value)
            ? value
            : throw new FormatException($"\"{text}\" is not an int.");
}
