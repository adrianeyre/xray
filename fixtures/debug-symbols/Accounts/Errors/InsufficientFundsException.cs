using System.Globalization;

namespace Ledger.Banking;

public sealed class InsufficientFundsException(string account, decimal missing)
    : Exception($"{account} is short by {missing.ToString("0.00", CultureInfo.InvariantCulture)}.")
{
    public decimal Missing { get; } = missing;
}
