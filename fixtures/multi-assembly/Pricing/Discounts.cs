using System;
using Inventory;

namespace Shop.Pricing;

public interface IDiscount
{
    string Name { get; }

    decimal Apply(Item item, int quantity, decimal subtotal);
}

/// <summary>An abstract class another Assembly derives from, overriding what it protects.</summary>
public abstract class Discount : IDiscount
{
    public abstract string Name { get; }

    public decimal Apply(Item item, int quantity, decimal subtotal) =>
        Applies(item, quantity) ? decimal.Round(subtotal * Rate, 2, MidpointRounding.AwayFromZero) : 0m;

    protected abstract decimal Rate { get; }

    protected virtual bool Applies(Item item, int quantity) => true;

    public override string ToString() => $"{Name} ({Rate:P0})";
}

public sealed class BulkDiscount(int atLeast) : Discount
{
    public override string Name => $"bulk, {atLeast} or more";

    protected override decimal Rate => 0.1m;

    protected override bool Applies(Item item, int quantity) => quantity >= atLeast;
}

public sealed class CategoryDiscount(Category category, decimal rate) : Discount
{
    public override string Name => $"{category.ToString().ToLowerInvariant()} sale";

    protected override decimal Rate => rate;

    protected override bool Applies(Item item, int quantity) => item.Category == category;
}
