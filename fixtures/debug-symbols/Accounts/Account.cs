namespace Ledger.Banking;

// Three types in one file, in a folder that is not named after their namespace.

public sealed class Account(string name) : IAccountSource
{
    private readonly List<Transaction> history = [];

    public string Name { get; } = name;

    public decimal Balance { get; private set; }

    public IReadOnlyList<Transaction> History => history;

    public Transaction Deposit(decimal amount) => Record(TransactionKind.Deposit, amount);

    public Transaction Withdraw(decimal amount)
    {
        var missing = amount - Balance;
        if (missing > 0)
        {
            throw new InsufficientFundsException(Name, missing);
        }

        return Record(TransactionKind.Withdrawal, -amount);
    }

    private Transaction Record(TransactionKind kind, decimal change)
    {
        Balance += change;
        var recorded = new Transaction(history.Count + 1, kind, change, Balance);
        history.Add(recorded);
        return recorded;
    }
}

public sealed record Transaction(int Number, TransactionKind Kind, decimal Change, decimal BalanceAfter);

public enum TransactionKind
{
    Deposit,
    Withdrawal,
}
