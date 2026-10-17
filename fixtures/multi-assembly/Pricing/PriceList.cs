using System;
using System.Collections.Generic;
using Inventory;

namespace Shop.Pricing;

public readonly record struct Quote(Item Item, int Quantity, decimal Subtotal, decimal Saving, string? DiscountName)
{
    public decimal Total => Subtotal - Saving;
}

public static class PriceList
{
    /// <param name="limit">Defaults to a constant of another Assembly's.</param>
    public static Quote Quote(IStock stock, Item item, int quantity, IDiscount? discount = null, int limit = Warehouse.MaxQuantity)
    {
        // SkuRules is internal to Inventory, which lets Pricing see it.
        if (!SkuRules.IsValid(item.Sku))
        {
            throw new ArgumentException($"\"{item.Sku}\" is not a SKU.", nameof(item));
        }

        if (quantity <= 0 || quantity > limit)
        {
            throw new ArgumentOutOfRangeException(nameof(quantity), quantity, $"Quote 1 to {limit}.");
        }

        var left = stock.CountOf(item.Sku);
        if (left < quantity)
        {
            throw new OutOfStockException(item.Sku, quantity, left);
        }

        var subtotal = item.Price * quantity;
        var saving = discount?.Apply(item, quantity, subtotal) ?? 0m;
        return new Quote(item, quantity, subtotal, saving, saving == 0m ? null : discount?.Name);
    }
}

/// <summary>A generic class, closed over another Assembly's types by the program.</summary>
public sealed class Totals<TKey>
    where TKey : notnull
{
    private readonly SortedDictionary<TKey, decimal> totals = new();

    public void Add(TKey key, decimal amount) =>
        totals[key] = totals.TryGetValue(key, out var total) ? total + amount : amount;

    public IEnumerable<KeyValuePair<TKey, decimal>> All => totals;
}
