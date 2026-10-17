using System.Globalization;
using Ledger.Banking;
using Ledger.Reports;

namespace Ledger;

/// <summary>
/// Applies each operation given, `deposit` or `withdraw` and an amount, to an
/// account, printing each transaction, then the account's statement.
/// </summary>
internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 0 || args.Length % 2 != 0)
        {
            Console.Error.WriteLine("Usage: DebugSymbols (deposit|withdraw) <amount> ...");
            return 1;
        }

        var account = new Account("Savings");
        for (var position = 0; position < args.Length; position += 2)
        {
            var operation = args[position];
            var given = args[position + 1];
            if (!decimal.TryParse(given, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount <= 0)
            {
                Console.Error.WriteLine($"Not an amount: {given}");
                return 1;
            }

            try
            {
                var transaction = operation switch
                {
                    "deposit" => account.Deposit(amount),
                    "withdraw" => account.Withdraw(amount),
                    _ => throw new ArgumentException($"Unknown operation: {operation}"),
                };
                Console.WriteLine(Formatter.Line(transaction));
            }
            catch (InsufficientFundsException shortfall)
            {
                Console.Error.WriteLine(shortfall.Message);
                return 2;
            }
            catch (ArgumentException unknown)
            {
                Console.Error.WriteLine(unknown.Message);
                return 1;
            }
        }

        var statement = new Statement(account);
        foreach (var line in statement.Lines())
        {
            Console.WriteLine(line);
        }

        return 0;
    }
}
