using System;
using System.Collections.Generic;
using System.Linq;

namespace Inventory;

public interface IStock
{
    IEnumerable<Item> Items { get; }

    int CountOf(string sku);
}

/// <summary>Thrown by Warehouse, caught by the program in another Assembly.</summary>
public sealed class OutOfStockException(string sku, int wanted, int left)
    : InvalidOperationException($"Only {left} of {sku} left, but {wanted} wanted.")
{
    public string Sku { get; } = sku;

    public int Wanted { get; } = wanted;

    public int Left { get; } = left;
}

public sealed class StockChangedEventArgs(Item item, int before, int after) : EventArgs
{
    public Item Item { get; } = item;

    public int Before { get; } = before;

    public int After { get; } = after;
}

public sealed class Warehouse : IStock
{
    /// <summary>A constant, compiled into the Assemblies that use it.</summary>
    public const int MaxQuantity = 1000;

    private readonly SortedDictionary<string, (Item Item, int Count)> stock = new(StringComparer.Ordinal);

    public event EventHandler<StockChangedEventArgs>? Changed;

    public IEnumerable<Item> Items => stock.Values.Select(entry => entry.Item);

    public int CountOf(string sku) => stock.TryGetValue(sku, out var entry) ? entry.Count : 0;

    public Item? Find(string sku) => stock.TryGetValue(sku, out var entry) ? entry.Item : null;

    public void Add(Item item, int count)
    {
        if (!SkuRules.IsValid(item.Sku))
        {
            throw new ArgumentException($"\"{item.Sku}\" is not a SKU.", nameof(item));
        }

        var before = CountOf(item.Sku);
        var after = Math.Min(before + count, MaxQuantity);
        stock[item.Sku] = (item, after);
        Changed?.Invoke(this, new StockChangedEventArgs(item, before, after));
    }

    public void Take(string sku, int count)
    {
        if (!stock.TryGetValue(sku, out var entry))
        {
            throw new KeyNotFoundException($"There is no {sku} in stock.");
        }

        if (entry.Count < count)
        {
            throw new OutOfStockException(sku, count, entry.Count);
        }

        stock[sku] = (entry.Item, entry.Count - count);
        Changed?.Invoke(this, new StockChangedEventArgs(entry.Item, entry.Count, entry.Count - count));
    }
}
