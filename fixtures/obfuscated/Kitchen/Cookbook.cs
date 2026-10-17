namespace Recipes.Kitchen;

/// <summary>Finds a recipe by its name.</summary>
public interface ICookbook
{
    IReadOnlyList<string> Names { get; }

    Recipe Find(string name);
}

/// <summary>A recipe: its ingredients, each by the serving.</summary>
public sealed class Recipe
{
    private readonly List<Ingredient> ingredients = new List<Ingredient>();

    public Recipe(string name)
    {
        Name = name;
    }

    public string Name { get; }

    public Recipe With(string ingredient, int perServing, Unit unit)
    {
        ingredients.Add(new Ingredient(ingredient, perServing, unit));
        return this;
    }

    public IEnumerable<string> For(int servings)
    {
        foreach (var ingredient in ingredients)
        {
            yield return ingredient.For(servings);
        }
    }
}

public sealed class RecipeNotFoundException : Exception
{
    public RecipeNotFoundException(string name, IEnumerable<string> known)
        : base("There is no recipe for " + name + ". Try " + string.Join(", ", known) + ".")
    {
    }
}

/// <summary>The recipes this program knows.</summary>
public sealed class Cookbook : ICookbook
{
    private readonly Dictionary<string, Recipe> recipes = new Dictionary<string, Recipe>(StringComparer.Ordinal);

    public Cookbook()
    {
        Add(new Recipe("pancakes")
            .With("flour", 50, Unit.Grams)
            .With("milk", 120, Unit.Millilitres)
            .With("egg", 1, Unit.Pieces));
        Add(new Recipe("omelette")
            .With("egg", 2, Unit.Pieces)
            .With("butter", 10, Unit.Grams)
            .With("chive", 3, Unit.Pieces));
    }

    public IReadOnlyList<string> Names => recipes.Keys.OrderBy(name => name, StringComparer.Ordinal).ToList();

    public Recipe Find(string name) =>
        recipes.TryGetValue(name, out var recipe) ? recipe : throw new RecipeNotFoundException(name, Names);

    private void Add(Recipe recipe)
    {
        recipes.Add(recipe.Name, recipe);
    }
}
