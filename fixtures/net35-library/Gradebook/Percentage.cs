using System;
using System.Globalization;

namespace Gradebook
{
    /// <summary>A mark out of 100, kept as a whole number of tenths so it adds and compares exactly.</summary>
    public struct Percentage : IComparable<Percentage>, IEquatable<Percentage>
    {
        private const int Whole = 1000;

        private readonly int tenths;

        public Percentage(int tenths)
        {
            if (tenths < 0 || tenths > Whole)
            {
                throw new ArgumentOutOfRangeException("tenths");
            }
            this.tenths = tenths;
        }

        public int Tenths
        {
            get { return tenths; }
        }

        /// <summary>The mean of some tenths, rounded half up to a whole tenth.</summary>
        public static Percentage Mean(int totalTenths, int count)
        {
            return new Percentage((totalTenths + count / 2) / count);
        }

        /// <summary>Raised by whole points, never past 100%.</summary>
        public static Percentage operator +(Percentage percentage, int points)
        {
            return new Percentage(Math.Min(Whole, percentage.tenths + points * 10));
        }

        public static bool operator >=(Percentage left, Percentage right)
        {
            return left.tenths >= right.tenths;
        }

        public static bool operator <=(Percentage left, Percentage right)
        {
            return left.tenths <= right.tenths;
        }

        public int CompareTo(Percentage other)
        {
            return tenths.CompareTo(other.tenths);
        }

        public bool Equals(Percentage other)
        {
            return tenths == other.tenths;
        }

        public override bool Equals(object obj)
        {
            return obj is Percentage && Equals((Percentage)obj);
        }

        public override int GetHashCode()
        {
            return tenths;
        }

        public override string ToString()
        {
            return string.Format(CultureInfo.InvariantCulture, "{0}.{1}%", tenths / 10, tenths % 10);
        }
    }
}
