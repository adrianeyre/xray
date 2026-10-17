using System.Globalization;
using Ledger.Banking;
using Ledger.Reports.Columns;

namespace Ledger.Reports;

/// <summary>A partial class: most of it here, its totals in Statement.Totals.cs.</summary>
public sealed partial class Statement(IAccountSource account)
{
    public IEnumerable<string> Lines()
    {
        yield return $"Statement for {account.Name}";
        foreach (var entry in account.History)
        {
            var number = entry.Number.ToString(CultureInfo.InvariantCulture);
            yield return $"{Column.Align(number, 3, Alignment.Right)} {Column.Align(Formatter.Money(entry.Change), 10, Alignment.Right)}";
        }

        yield return Totals();
    }

    private int Count => account.History.Count;
}
