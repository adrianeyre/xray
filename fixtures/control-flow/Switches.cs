using System;
using System.Globalization;

namespace ControlFlow;

internal enum Light
{
    Red,
    RedAmber,
    Green,
    Amber,
}

/// <summary>
/// Switch statements as the compiler lowers them differently: dense cases to
/// a jump table, sparse ones to comparisons, many strings to a hash of the
/// string, and an enum. Some jump between sections with goto case and goto
/// default.
/// </summary>
internal static class Switches
{
    public static void Run(string operand)
    {
        if (int.TryParse(operand, NumberStyles.Integer, CultureInfo.InvariantCulture, out int n))
        {
            Console.WriteLine($"{n}: {Ordinal(n)}; {Day(n)}; {Magnitude(n)}; light after {n} changes is {After(n)}");
        }
        else
        {
            Console.WriteLine($"\"{operand}\": {Colour(operand)}");
        }
    }

    private static string Ordinal(int n)
    {
        string suffix;
        switch (Math.Abs(n % 100))
        {
            case 11:
            case 12:
            case 13:
                suffix = "th";
                break;
            default:
                switch (Math.Abs(n % 10))
                {
                    case 1:
                        suffix = "st";
                        break;
                    case 2:
                        suffix = "nd";
                        break;
                    case 3:
                        suffix = "rd";
                        break;
                    default:
                        suffix = "th";
                        break;
                }

                break;
        }

        return $"{n}{suffix}";
    }

    /// <summary>Day 0 is a Sunday; dense cases, so a jump table.</summary>
    private static string Day(int n)
    {
        var day = (n % 7 + 7) % 7;
        string name;
        switch (day)
        {
            case 0:
                name = "Sunday";
                break;
            case 1:
                name = "Monday";
                break;
            case 2:
                name = "Tuesday";
                break;
            case 3:
                name = "Wednesday";
                break;
            case 4:
                name = "Thursday";
                break;
            case 5:
                name = "Friday";
                break;
            case 6:
                name = "Saturday";
                break;
            default:
                throw new InvalidOperationException($"There is no day {day}.");
        }

        switch (day)
        {
            case 0:
            case 6:
                return $"day {n} is a {name}, at the weekend";
            case 5:
                return $"day {n} is a {name}, nearly the weekend";
            default:
                return $"day {n} is a {name}";
        }
    }

    /// <summary>Sparse cases, so comparisons; some jump to another section.</summary>
    private static string Magnitude(int n)
    {
        var negative = false;
        var lucky = false;
        switch (n)
        {
            case int.MinValue:
                return "the smallest int";
            case int.MaxValue:
                return "the largest int";
            case 0:
                return "zero";
            case -1:
            case -10:
            case -100:
            case -1000:
                negative = true;
                goto case 1;
            case 1:
            case 10:
            case 100:
            case 1000:
                return negative ? "minus a power of ten" : "a power of ten";
            case 7:
            case 13:
                lucky = true;
                goto default;
            default:
                return (n % 2 == 0 ? "even" : "odd") + (lucky ? " and lucky" : "");
        }
    }

    private static Light Next(Light light)
    {
        switch (light)
        {
            case Light.Red:
                return Light.RedAmber;
            case Light.RedAmber:
                return Light.Green;
            case Light.Green:
                return Light.Amber;
            default:
                return Light.Red;
        }
    }

    /// <summary>The lights cycle every four changes, so only the remainder matters.</summary>
    private static Light After(int changes)
    {
        var light = Light.Red;
        for (var i = 0; i < changes % 4; i++)
        {
            light = Next(light);
        }

        return light;
    }

    /// <summary>Enough string cases that the compiler switches on their hash.</summary>
    private static string Colour(string word)
    {
        switch (word.ToLowerInvariant())
        {
            case "black":
                return "#000000";
            case "white":
                return "#FFFFFF";
            case "red":
                return "#FF0000";
            case "green":
                return "#008000";
            case "blue":
                return "#0000FF";
            case "yellow":
                return "#FFFF00";
            case "gray":
                return "#808080";
            case "grey":
                goto case "gray";
            default:
                return "not a colour";
        }
    }
}
