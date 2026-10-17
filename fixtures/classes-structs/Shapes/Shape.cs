using System;

namespace ClassesStructs.Shapes;

/// <summary>
/// The base of every shape: numbered in the order they are made, ordered by
/// area through an explicitly implemented interface.
/// </summary>
public abstract class Shape : IShape, IComparable<Shape>
{
    private static int created;

    protected Shape(string name)
    {
        this.name = name;
        Id = ++created;
    }

    private readonly string name;

    public static int Created => created;

    public int Id { get; }

    public virtual string Name => name;

    public abstract double Area { get; }

    public abstract double Perimeter { get; }

    int IComparable<Shape>.CompareTo(Shape? other) => other is null ? 1 : Area.CompareTo(other.Area);

    public override string ToString() => $"#{Id} {Name}";
}

public sealed class Circle : Shape, IScalable
{
    public Circle(double radius)
        : base("circle")
    {
        Radius = radius;
    }

    public double Radius { get; }

    public override double Area => Math.PI * Radius * Radius;

    public override double Perimeter => 2 * Math.PI * Radius;

    public IShape Scale(double factor) => new Circle(Radius * factor);
}

/// <summary>
/// Lists IShape again, though Shape already implements it, so its own Describe
/// re-implements IShape.Describe in place of the default.
/// </summary>
public class Rectangle : Shape, IShape, IScalable
{
    public Rectangle(double width, double height)
        : this("rectangle", width, height)
    {
    }

    protected Rectangle(string name, double width, double height)
        : base(name)
    {
        Width = width;
        Height = height;
    }

    public double Width { get; }

    public double Height { get; }

    public override double Area => Width * Height;

    public override double Perimeter => 2 * (Width + Height);

    public virtual IShape Scale(double factor) => new Rectangle(Width * factor, Height * factor);

    public string Describe() => $"{Name} {Width} x {Height}: area {Area:0.###}";
}

/// <summary>
/// Hides Rectangle.Describe rather than overriding it, so which one runs
/// depends on the type it is called through: IShape still maps to Rectangle's.
/// </summary>
public sealed class Square : Rectangle
{
    public Square(double side)
        : base("square", side, side)
    {
    }

    public override IShape Scale(double factor) => new Square(Width * factor);

    public new string Describe() => $"{Name} of side {Width}";
}

/// <summary>Keeps IShape's default Describe.</summary>
public sealed class Triangle : Shape
{
    private readonly double a;
    private readonly double b;
    private readonly double c;

    public Triangle(double a, double b, double c)
        : base("triangle")
    {
        if (a + b <= c || a + c <= b || b + c <= a)
        {
            throw new FormatException($"No triangle has sides {a}, {b} and {c}.");
        }

        this.a = a;
        this.b = b;
        this.c = c;
    }

    public override string Name => a == b && b == c ? "equilateral " + base.Name : base.Name;

    public override double Perimeter => a + b + c;

    /// <summary>Heron's formula.</summary>
    public override double Area
    {
        get
        {
            var s = Perimeter / 2;
            return Math.Sqrt(s * (s - a) * (s - b) * (s - c));
        }
    }
}
