namespace Inventory;

/// <summary>Internal to Inventory, but visible to Pricing (InternalsVisibleTo).</summary>
internal static class SkuRules
{
    internal const int Length = 6;

    /// <summary>Three upper-case letters, a dash, and two digits: "HAM-01".</summary>
    internal static bool IsValid(string sku)
    {
        if (sku.Length != Length || sku[3] != '-')
        {
            return false;
        }

        for (var i = 0; i < Length; i++)
        {
            var c = sku[i];
            var valid = i < 3 ? c is >= 'A' and <= 'Z' : i == 3 || char.IsAsciiDigit(c);
            if (!valid)
            {
                return false;
            }
        }

        return true;
    }
}
