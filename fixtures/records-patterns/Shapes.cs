using System;

namespace RecordsPatterns.Shapes;

public abstract record Shape;

public sealed record Circle(double Radius) : Shape;

public sealed record Rectangle(double Width, double Height) : Shape;

public sealed record Triangle(double A, double B, double C) : Shape;

/// <summary>Shapes told apart by type, positional and property patterns, with guards.</summary>
public static class ShapeDescriber
{
    public static string Describe(Shape? shape) => shape switch
    {
        null => "nothing",
        Circle { Radius: <= 0 } => "a degenerate circle",
        Circle(var radius) when radius > 100 => $"a huge circle of radius {radius}",
        Circle circle => $"a circle of area {Math.Round(Math.PI * circle.Radius * circle.Radius, 2)}",
        Rectangle { Width: var width, Height: var height } when width == height => $"a square of side {width}",
        Rectangle(> 0, > 0) rectangle => $"a rectangle of area {rectangle.Width * rectangle.Height}",
        Rectangle => "a degenerate rectangle",
        Triangle(var a, var b, var c) when a == b && b == c => "an equilateral triangle",
        Triangle(var a, var b, var c) when a == b || b == c || a == c => "an isosceles triangle",
        Triangle => "a scalene triangle",
        _ => $"an unknown {shape.GetType().Name}",
    };

    /// <summary>Parses "circle:2", "rectangle:3:4", "triangle:3:4:5" or "none" with list patterns.</summary>
    public static Shape? Parse(string text) => text.Split(':') switch
    {
        ["none"] => null,
        ["circle", var radius] => new Circle(Number(radius)),
        ["rectangle", var width, var height] => new Rectangle(Number(width), Number(height)),
        ["triangle", var a, var b, var c] => new Triangle(Number(a), Number(b), Number(c)),
        [var kind, ..] => throw new FormatException($"\"{kind}\" is not a shape with {text.Split(':').Length - 1} dimensions."),
        // Split never returns an empty array.
        [] => throw new FormatException("Give a shape."),
    };

    private static double Number(string text) =>
        double.TryParse(text, out var number)
            ? number
            : throw new FormatException($"\"{text}\" is not a number.");
}
