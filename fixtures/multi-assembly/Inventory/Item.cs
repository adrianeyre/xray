namespace Inventory;

public enum Category
{
    Tools,
    Garden,
    Kitchen,
}

/// <summary>A line of stock: a record, compared by value in another Assembly.</summary>
public sealed record Item(string Sku, string Name, Category Category, decimal Price);

public static class ItemExtensions
{
    /// <summary>An extension method, called from the program as if it were Item's own.</summary>
    public static string Describe(this Item item) => $"{item.Sku} {item.Name} ({item.Category})";
}
