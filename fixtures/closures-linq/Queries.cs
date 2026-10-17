using System;
using System.Collections.Generic;
using System.Linq;

namespace ClosuresLinq;

internal sealed record Person(string Name, string Team, int Age);

internal sealed record Team(string Name, string Floor);

/// <summary>
/// LINQ in query syntax, which the compiler turns into method calls and
/// lambdas, a <c>let</c> or a second <c>from</c> into anonymous types carrying
/// the range variables along. Strings are ordered by their characters, never
/// by culture.
/// </summary>
internal static class Queries
{
    private static readonly Team[] Teams =
    [
        new("core", "first"),
        new("engine", "second"),
        new("docs", "third"),
    ];

    /// <summary><c>name:team:age</c>, each a Person.</summary>
    public static Person[] People(string[] operands)
    {
        var people = new Person[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            var parts = operands[i].Split(':');
            if (parts.Length != 3 || !int.TryParse(parts[2], out var age))
            {
                throw new FormatException($"\"{operands[i]}\" is not name:team:age.");
            }

            people[i] = new Person(parts[0], parts[1], age);
        }

        return people;
    }

    public static IEnumerable<string> Words(string[] words) =>
        from word in words
        let upper = word.ToUpperInvariant()
        where word.Length > 2
        orderby word.Length descending, word[0]
        select $"{upper} ({word.Length})";

    public static IEnumerable<string> ByLength(string[] words) =>
        from word in words
        group word by word.Length into byLength
        orderby byLength.Key
        select $"{byLength.Key}: {string.Join(", ", byLength)}";

    public static IEnumerable<string> Pairs(int[] numbers) =>
        from left in numbers
        from right in numbers
        where left < right
        let sum = left + right
        where sum % 2 == 0
        select $"{left}+{right}={sum}";

    /// <summary>An inner join, then a group join flattened to a left outer join.</summary>
    public static IEnumerable<string> Floors(Person[] people)
    {
        var inner =
            from person in people
            join team in Teams on person.Team equals team.Name
            orderby person.Age, person.Name.Length
            select $"{person.Name} works on the {team.Floor} floor";
        var outer =
            from person in people
            join team in Teams on person.Team equals team.Name into teams
            from team in teams.DefaultIfEmpty()
            select $"{person.Name}: {team?.Floor ?? "no floor"}";
        var headcount =
            from team in Teams
            join person in people on team.Name equals person.Team into members
            select $"{team.Name} has {members.Count()} (ages {members.Sum(member => member.Age)})";
        return inner.Concat(outer).Concat(headcount);
    }

    /// <summary>Anonymous types: compared, printed and grouped by value.</summary>
    public static IEnumerable<string> Anonymous(Person[] people)
    {
        var summaries =
            from person in people
            group person by new { person.Team, Adult = person.Age >= 18 } into byTeam
            select new { byTeam.Key.Team, byTeam.Key.Adult, Count = byTeam.Count() };
        foreach (var summary in summaries)
        {
            yield return $"{summary}";
        }

        var first = new { Name = "a", Age = 1 };
        var second = new { Name = "a", Age = 1 };
        yield return $"equal by value: {first.Equals(second)}, the same: {ReferenceEquals(first, second)}";
    }
}
