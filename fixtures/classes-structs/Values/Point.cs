using System;
using System.Globalization;

namespace ClassesStructs.Values;

/// <summary>An immutable value, with operators, equality and conversions.</summary>
public readonly struct Point : IEquatable<Point>
{
    public Point(int x, int y)
    {
        X = x;
        Y = y;
    }

    public static Point Origin => default;

    public int X { get; }

    public int Y { get; }

    public int ManhattanLength => Math.Abs(X) + Math.Abs(Y);

    public static Point operator +(Point left, Point right) => new(left.X + right.X, left.Y + right.Y);

    public static Point operator -(Point left, Point right) => new(left.X - right.X, left.Y - right.Y);

    public static Point operator -(Point point) => new(-point.X, -point.Y);

    public static Point operator *(Point point, int factor) => new(point.X * factor, point.Y * factor);

    public static bool operator ==(Point left, Point right) => left.Equals(right);

    public static bool operator !=(Point left, Point right) => !left.Equals(right);

    /// <summary>From "x,y".</summary>
    public static explicit operator Point(string text)
    {
        var parts = text.Split(',');
        if (parts.Length != 2
            || !int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out int x)
            || !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out int y))
        {
            throw new FormatException($"\"{text}\" is not a point.");
        }

        return new Point(x, y);
    }

    public bool Equals(Point other) => X == other.X && Y == other.Y;

    public override bool Equals(object? obj) => obj is Point other && Equals(other);

    public override int GetHashCode() => unchecked(X * 397 ^ Y);

    public override string ToString() => $"({X}, {Y})";
}
