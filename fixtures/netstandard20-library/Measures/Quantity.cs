using System;
using System.Globalization;

namespace Measures
{
    public sealed class IncompatibleUnitsException : InvalidOperationException
    {
        public IncompatibleUnitsException(Unit from, Unit to)
            : base($"Cannot convert {from.Symbol} to {to.Symbol}: {from.Dimension} is not {to.Dimension}.")
        {
        }
    }

    /// <summary>An amount of a unit; equal to another of the same dimension that is as much.</summary>
    public readonly struct Quantity : IEquatable<Quantity>, IComparable<Quantity>
    {
        public Quantity(decimal amount, Unit unit)
        {
            Amount = amount;
            Unit = unit ?? throw new ArgumentNullException(nameof(unit));
        }

        public decimal Amount { get; }

        public Unit Unit { get; }

        private decimal InBase => Amount * Unit.PerBase;

        public Quantity To(Unit target)
        {
            if (target.Dimension != Unit.Dimension)
            {
                throw new IncompatibleUnitsException(Unit, target);
            }
            return new Quantity(InBase / target.PerBase, target);
        }

        /// <summary>The sum, in the left one's unit.</summary>
        public static Quantity operator +(Quantity left, Quantity right) =>
            new Quantity(left.Amount + right.To(left.Unit).Amount, left.Unit);

        public static Quantity Scale(in Quantity quantity, decimal factor) =>
            new Quantity(quantity.Amount * factor, quantity.Unit);

        public void Deconstruct(out decimal amount, out string symbol)
        {
            amount = Amount;
            symbol = Unit.Symbol;
        }

        public int CompareTo(Quantity other) => Amount.CompareTo(other.To(Unit).Amount);

        public bool Equals(Quantity other) => Unit.Dimension == other.Unit.Dimension && InBase == other.InBase;

        public override bool Equals(object obj) => obj is Quantity other && Equals(other);

        public override int GetHashCode() => InBase.GetHashCode() ^ (int)Unit.Dimension;

        public override string ToString() =>
            Amount.ToString("0.###", CultureInfo.InvariantCulture) + " " + Unit.Symbol;
    }
}
