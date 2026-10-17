using Ledger.Banking;

namespace Ledger.Reports;

public sealed partial class Statement
{
    private string Totals()
    {
        var deposits = account.History.Where(entry => entry.Kind == TransactionKind.Deposit).Sum(entry => entry.Change);
        var withdrawals = account.History.Where(entry => entry.Kind == TransactionKind.Withdrawal).Sum(entry => entry.Change);
        return $"{Count} transactions: in {Formatter.Money(deposits)}, out {Formatter.Money(withdrawals)}, balance {Formatter.Money(deposits + withdrawals)}";
    }
}
