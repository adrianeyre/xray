using System;
using System.Collections.Generic;
using System.Linq;

namespace Measures
{
    public enum Dimension
    {
        Length,
        Mass,
        Volume,
    }

    /// <summary>A unit, and how many of its dimension's base unit (metre, gram, millilitre) one of it is.</summary>
    public sealed class Unit
    {
        internal Unit(string symbol, string name, Dimension dimension, decimal perBase)
        {
            Symbol = symbol;
            Name = name;
            Dimension = dimension;
            PerBase = perBase;
        }

        public string Symbol { get; }

        public string Name { get; }

        public Dimension Dimension { get; }

        public decimal PerBase { get; }
    }

    public static class Units
    {
        private static readonly Dictionary<string, Unit> BySymbol = new[]
        {
            new Unit("m", "metre", Dimension.Length, 1m),
            new Unit("cm", "centimetre", Dimension.Length, 0.01m),
            new Unit("km", "kilometre", Dimension.Length, 1000m),
            new Unit("mi", "mile", Dimension.Length, 1609.344m),
            new Unit("g", "gram", Dimension.Mass, 1m),
            new Unit("kg", "kilogram", Dimension.Mass, 1000m),
            new Unit("lb", "pound", Dimension.Mass, 453.59237m),
            new Unit("ml", "millilitre", Dimension.Volume, 1m),
            new Unit("l", "litre", Dimension.Volume, 1000m),
            new Unit("gal", "gallon", Dimension.Volume, 3785.411784m),
        }.ToDictionary(unit => unit.Symbol, StringComparer.Ordinal);

        public static bool TryFind(string symbol, out Unit unit) => BySymbol.TryGetValue(symbol, out unit);

        /// <summary>Each dimension, in order, with the symbols of its units, sorted.</summary>
        public static IEnumerable<(Dimension Dimension, IReadOnlyList<string> Symbols)> ByDimension() =>
            BySymbol.Values
                .GroupBy(unit => unit.Dimension)
                .OrderBy(group => group.Key)
                .Select(group => (group.Key, (IReadOnlyList<string>)group.Select(unit => unit.Symbol).OrderBy(symbol => symbol, StringComparer.Ordinal).ToList()));
    }
}
