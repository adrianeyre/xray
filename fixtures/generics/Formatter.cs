using System;
using System.Globalization;

namespace Generics;

/// <summary>A generic method overridden: the override inherits its constraint rather than stating it.</summary>
public abstract class Formatter
{
    public abstract string Format<T>(T value)
        where T : IFormattable;
}

public sealed class HexFormatter : Formatter
{
    public override string Format<T>(T value) => value.ToString("X", CultureInfo.InvariantCulture);
}

public sealed class FixedFormatter : Formatter
{
    public override string Format<T>(T value) => value.ToString("F2", CultureInfo.InvariantCulture);
}
