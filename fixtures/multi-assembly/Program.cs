using System;
using System.Collections.Generic;
using System.Globalization;
using Inventory;
using Shop.Pricing;

namespace MultiAssembly;

/// <summary>
/// Keeps a small shop's stock (Inventory) and prices it (Pricing): two class
/// libraries, built beside this program as Sibling Assemblies, that it calls
/// across, derives from, and catches the exceptions of.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int NotFound = 2;
    private const int OutOfStock = 3;

    private const string Usage = "Usage: MultiAssembly stock | quote <sku> <quantity> [bulk|garden|half] | take <sku> <quantity>";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        var warehouse = Stocked();
        try
        {
            switch (args)
            {
                case ["stock"]:
                    PrintStock(warehouse);
                    return Succeeded;
                case ["quote", var sku, var quantity]:
                    PrintQuote(warehouse, sku, ParseQuantity(quantity), null);
                    return Succeeded;
                case ["quote", var sku, var quantity, var discount]:
                    PrintQuote(warehouse, sku, ParseQuantity(quantity), DiscountNamed(discount));
                    return Succeeded;
                case ["take", var sku, var quantity]:
                    warehouse.Changed += (_, change) =>
                        Console.WriteLine($"{change.Item.Sku}: {change.Before} -> {change.After}");
                    warehouse.Take(sku, ParseQuantity(quantity));
                    PrintStock(warehouse);
                    return Succeeded;
                default:
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (OutOfStockException exception)
        {
            Console.Error.WriteLine(exception.Message);
            Console.Error.WriteLine($"Short by {exception.Wanted - exception.Left}.");
            return OutOfStock;
        }
        catch (KeyNotFoundException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return NotFound;
        }
        catch (ArgumentOutOfRangeException exception)
        {
            Console.Error.WriteLine($"{exception.ParamName} {exception.ActualValue}: Quote 1 to {Warehouse.MaxQuantity}.");
            return InvalidInput;
        }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return InvalidInput;
        }
        catch (FormatException)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }
    }

    private static Warehouse Stocked()
    {
        var warehouse = new Warehouse();
        warehouse.Add(new Item("HAM-01", "Hammer", Category.Tools, 9.99m), 12);
        warehouse.Add(new Item("SAW-02", "Saw", Category.Tools, 24.50m), 3);
        warehouse.Add(new Item("HOE-07", "Hoe", Category.Garden, 15m), 5);
        warehouse.Add(new Item("POT-10", "Pot", Category.Kitchen, 32.25m), 2);
        // The same SKU again: a record equal by value, added to its count.
        warehouse.Add(new Item("HAM-01", "Hammer", Category.Tools, 9.99m), 4);
        return warehouse;
    }

    private static void PrintStock(Warehouse warehouse)
    {
        var totals = new Totals<Category>();
        foreach (var item in warehouse.Items)
        {
            var count = warehouse.CountOf(item.Sku);
            Console.WriteLine($"{item.Describe()}: {count} at {item.Price:0.00}");
            totals.Add(item.Category, item.Price * count);
        }

        foreach (var (category, total) in totals.All)
        {
            Console.WriteLine($"{category}: {total:0.00}");
        }
    }

    private static void PrintQuote(Warehouse warehouse, string sku, int quantity, IDiscount? discount)
    {
        var item = warehouse.Find(sku) ?? throw new KeyNotFoundException($"There is no {sku} in stock.");
        var quote = PriceList.Quote(warehouse, item, quantity, discount);
        Console.WriteLine($"{quote.Quantity} x {quote.Item.Describe()} = {quote.Subtotal:0.00}");
        if (quote.DiscountName is { } name)
        {
            Console.WriteLine($"Less {name}: {quote.Saving:0.00}");
        }

        Console.WriteLine($"Total: {quote.Total:0.00}");
        // A record struct of Pricing's, compared with its own == across Assemblies.
        var again = PriceList.Quote(warehouse, item, quantity, discount);
        Console.WriteLine(quote == again ? "Quotes compare by value." : "Quotes compare by reference.");
    }

    private static IDiscount DiscountNamed(string name) => name switch
    {
        "bulk" => new BulkDiscount(10),
        "garden" => new CategoryDiscount(Category.Garden, 0.25m),
        "half" => new HalfPriceOn("HAM-01", "SAW-02"),
        _ => throw new ArgumentException($"There is no discount \"{name}\"."),
    };

    private static int ParseQuantity(string text) => int.Parse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
}

/// <summary>A Discount of the program's own, overriding the protected members of a class in Pricing.</summary>
internal sealed class HalfPriceOn(params string[] skus) : Discount
{
    public override string Name => $"half price on {string.Join(" and ", skus)}";

    protected override decimal Rate => 0.5m;

    protected override bool Applies(Item item, int quantity) => Array.IndexOf(skus, item.Sku) >= 0;
}
