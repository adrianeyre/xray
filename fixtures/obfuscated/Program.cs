using Recipes.Kitchen;

namespace Recipes;

/// <summary>
/// Scales a recipe to a number of servings and prints what it takes, one
/// ingredient to a line. Nothing about it is unusual: what is under test is
/// what Obfuscar makes of it as it is built (see Obfuscated.csproj).
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int UnknownRecipe = 2;

    private const int MostServings = 12;

    private static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine("Usage: Obfuscated <recipe> <servings>");
            return InvalidInput;
        }

        if (!int.TryParse(args[1], out var servings) || servings < 1 || servings > MostServings)
        {
            Console.Error.WriteLine("Servings must be a whole number from 1 to " + MostServings + ", not " + args[1] + ".");
            return InvalidInput;
        }

        ICookbook cookbook = new Cookbook();
        Recipe recipe;
        try
        {
            recipe = cookbook.Find(args[0]);
        }
        catch (RecipeNotFoundException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return UnknownRecipe;
        }

        Console.WriteLine(Title(recipe.Name) + " for " + servings + ":");
        foreach (var line in recipe.For(servings))
        {
            Console.WriteLine("  " + line);
        }

        return Succeeded;
    }

    private static string Title(string name) => char.ToUpperInvariant(name[0]) + name.Substring(1);
}
