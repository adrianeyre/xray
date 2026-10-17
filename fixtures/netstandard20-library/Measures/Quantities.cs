using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;

namespace Measures
{
    public static class Quantities
    {
        /// <summary>
        /// A quantity written as an amount then a unit's symbol, <c>1.5km</c>,
        /// or why the text is not one.
        /// </summary>
        public static (Quantity Quantity, string Error) Parse(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return (default(Quantity), "Nothing to read.");
            }
            var split = SymbolStart(text);
            switch (split)
            {
                case 0:
                    return (default(Quantity), $"No amount in \"{text}\".");
                case int at when at == text.Length:
                    return (default(Quantity), $"No unit in \"{text}\".");
            }
            var number = text.Substring(0, split);
            if (!decimal.TryParse(number, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
            {
                return (default(Quantity), $"\"{number}\" is not an amount.");
            }
            var symbol = text.Substring(split);
            return Units.TryFind(symbol, out var unit)
                ? (new Quantity(amount, unit), (string)null)
                : (default(Quantity), $"Unknown unit \"{symbol}\".");

            int SymbolStart(string s)
            {
                for (var i = 0; i < s.Length; i++)
                {
                    if (char.IsLetter(s[i]))
                    {
                        return i;
                    }
                }
                return s.Length;
            }
        }

        /// <summary>What a value is, in words.</summary>
        public static string Describe(object value)
        {
            switch (value)
            {
                case null:
                    return "nothing at all";
                case Quantity quantity when quantity.Amount == 0:
                    return $"no {quantity.Unit.Name}s";
                case Quantity quantity when quantity.Amount < 0:
                    return $"a shortfall of {-quantity.Amount:0.###} {quantity.Unit.Symbol}";
                case Quantity quantity:
                    var (amount, symbol) = quantity;
                    return $"{amount:0.###} {symbol} of {quantity.Unit.Dimension.ToString().ToLowerInvariant()}";
                case string text:
                    return $"the text \"{text}\"";
                default:
                    return value.GetType().Name;
            }
        }

        /// <summary>From one quantity up to another, in the first one's unit, a step at a time.</summary>
        public static IEnumerable<Quantity> Range(Quantity from, Quantity to, Quantity step)
        {
            var end = to.To(from.Unit).Amount;
            var by = step.To(from.Unit).Amount;
            if (by <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(step), "The step must be more than nothing.");
            }
            for (var amount = from.Amount; amount <= end; amount += by)
            {
                yield return new Quantity(amount, from.Unit);
            }
        }

        /// <summary>The sum, in the first one's unit, added one at a time.</summary>
        public static async Task<Quantity> SumAsync(IReadOnlyList<Quantity> quantities)
        {
            if (quantities.Count == 0)
            {
                throw new ArgumentException("Nothing to add.", nameof(quantities));
            }
            var total = quantities[0];
            for (var i = 1; i < quantities.Count; i++)
            {
                await Task.Yield();
                total += quantities[i];
            }
            return total;
        }
    }
}
