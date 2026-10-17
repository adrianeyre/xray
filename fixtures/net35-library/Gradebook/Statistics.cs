using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Gradebook
{
    public static class Statistics
    {
        private static readonly Percentage HonoursAt = new Percentage(850);
        private static readonly Percentage AtRiskBelow = new Percentage(500);

        /// <summary>The mean of the marks a student sat; 0% if none.</summary>
        public static Percentage Average(this Student student)
        {
            List<int> sat = student.Sat().ToList();
            return sat.Count == 0 ? new Percentage(0) : Percentage.Mean(sat.Sum() * 10, sat.Count);
        }

        public static Standing StandingOf(this Student student)
        {
            Standing standing = Standing.None;
            Percentage average = student.Average();
            if (average >= HonoursAt)
            {
                standing |= Standing.Honours;
            }
            int[] sat = student.Sat().ToArray();
            if (sat.Length >= 2 && sat[sat.Length - 1] > sat[0])
            {
                standing |= Standing.Improving;
            }
            if (!(average >= AtRiskBelow) || student.Missed > 1)
            {
                standing |= Standing.AtRisk;
            }
            return standing;
        }

        /// <summary>The first <paramref name="count"/> of a sequence, highest first by <paramref name="key"/>, ties in their order.</summary>
        public static IEnumerable<T> Top<T>(this IEnumerable<T> source, int count, Func<T, Percentage> key)
        {
            if (count < 0)
            {
                throw new ArgumentOutOfRangeException("count");
            }
            int taken = 0;
            foreach (T item in source.OrderByDescending(key))
            {
                if (taken++ == count)
                {
                    yield break;
                }
                yield return item;
            }
        }

        /// <summary>Each student's average raised by <paramref name="points"/>, graded by <paramref name="scheme"/>.</summary>
        public static IEnumerable<string> Curve(this Book book, int points, IGradingScheme scheme)
        {
            Func<Percentage, Percentage> raise = average => average + points;
            return book.Students.Select(student =>
            {
                Percentage average = student.Average();
                Percentage raised = raise(average);
                return string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}: {1} -> {2} {3}",
                    student.Name,
                    average,
                    raised,
                    scheme.Grade(raised));
            });
        }

        /// <summary>One line for each form, in order: how many are in it, their mean, and its best.</summary>
        public static IEnumerable<string> FormReport(this Book book, IGradingScheme scheme)
        {
            var forms =
                from student in book.Students
                let average = student.Average()
                group new { student.Name, Average = average } by student.Form into form
                orderby form.Key
                select new
                {
                    Form = form.Key,
                    Count = form.Count(),
                    Mean = Percentage.Mean(form.Sum(member => member.Average.Tenths), form.Count()),
                    Best = form.OrderByDescending(member => member.Average).First(),
                };
            foreach (var form in forms)
            {
                yield return string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}: {1} students, mean {2}, best {3} {4} ({5})",
                    form.Form,
                    form.Count,
                    form.Mean,
                    form.Best.Name,
                    form.Best.Average,
                    scheme.Grade(form.Best.Average));
            }
        }
    }
}
