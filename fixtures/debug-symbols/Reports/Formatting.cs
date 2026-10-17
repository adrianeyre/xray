using System.Globalization;
using Ledger.Banking;

// A file named after none of its types, declaring two namespaces, one with a
// file-scoped type only this file can see.

namespace Ledger.Reports
{
    public static class Formatter
    {
        public static string Line(Transaction transaction)
        {
            var label = transaction.Kind == TransactionKind.Deposit ? "deposit" : "withdraw";
            return $"#{transaction.Number} {Widths.Pad(label)} {Money(transaction.Change)} -> {Money(transaction.BalanceAfter)}";
        }

        public static string Money(decimal amount) =>
            amount.ToString("+0.00;-0.00;0.00", CultureInfo.InvariantCulture);
    }

    file static class Widths
    {
        public static string Pad(string text) => text.PadRight(9, '.');
    }
}

namespace Ledger.Reports.Columns
{
    public enum Alignment
    {
        Left,
        Right,
    }

    public static class Column
    {
        public static string Align(string text, int width, Alignment alignment) =>
            alignment == Alignment.Left ? text.PadRight(width) : text.PadLeft(width);
    }
}
