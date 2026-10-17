using System.Globalization;
using System.Resources;

namespace Phrasebook.Phrases;

/// <summary>
/// The menu's items, named by Menu.resx, which a resource manager finds by
/// this type's full name, as Visual Studio's generated classes do.
/// </summary>
internal static class Menu
{
    private static readonly ResourceManager Names = new(typeof(Menu));

    public static readonly string[] Items = ["Coffee", "Tea", "Water"];

    public static string Name(string item, CultureInfo culture) => Names.GetString(item, culture) ?? $"({item})";
}
