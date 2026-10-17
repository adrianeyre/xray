namespace Recipes.Kitchen;

/// <summary>How an ingredient is measured.</summary>
public enum Unit
{
    Grams,
    Millilitres,
    Pieces,
}

/// <summary>An ingredient of a recipe, and how much of it one serving takes.</summary>
public sealed class Ingredient
{
    public Ingredient(string name, int perServing, Unit unit)
    {
        Name = name;
        PerServing = perServing;
        Unit = unit;
    }

    public string Name { get; }

    public int PerServing { get; }

    public Unit Unit { get; }

    /// <summary>How much of it <paramref name="servings"/> servings take, measured: <c>250 g flour</c>.</summary>
    public string For(int servings)
    {
        var amount = PerServing * servings;
        return Unit switch
        {
            Unit.Grams => amount + " g " + Name,
            Unit.Millilitres => amount + " ml " + Name,
            _ => amount + " " + (amount == 1 ? Name : Name + "s"),
        };
    }
}
