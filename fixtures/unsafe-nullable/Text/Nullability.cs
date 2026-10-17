using System;
using System.Linq;
using System.Reflection;

namespace Fixtures.Pointers.Text;

/// <summary>
/// Prints the nullability each public member of a type was compiled with, as
/// its nullable attributes record it: <c>Nullable</c> for <c>string?</c>,
/// <c>NotNull</c> for <c>string</c>, and <c>Unknown</c> for a member compiled
/// outside a nullable context.
/// </summary>
internal static class Nullability
{
    public static void Print(Type type)
    {
        var context = new NullabilityInfoContext();
        const BindingFlags Declared = BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        foreach (var property in type.GetProperties(Declared).OrderBy(property => property.Name, StringComparer.Ordinal))
        {
            Console.WriteLine($"property {property.Name}: {Shown(context.Create(property))}");
        }

        foreach (var method in type.GetMethods(Declared)
                     .Where(method => !method.IsSpecialName)
                     .OrderBy(method => method.Name, StringComparer.Ordinal))
        {
            var parameters = method.GetParameters().Select(parameter => $"{parameter.Name}: {Shown(context.Create(parameter))}");
            Console.WriteLine($"method {method.Name}({string.Join(", ", parameters)}) returns {Shown(context.Create(method.ReturnParameter))}");
        }
    }

    /// <summary>The read state, and the element's or type arguments' if there are any.</summary>
    private static string Shown(NullabilityInfo info)
    {
        var shown = info.ReadState.ToString();
        if (info.ElementType is { } element)
        {
            shown += $" of {Shown(element)}";
        }

        if (info.GenericTypeArguments.Length > 0)
        {
            shown += $"<{string.Join(", ", info.GenericTypeArguments.Select(Shown))}>";
        }

        return shown;
    }
}
