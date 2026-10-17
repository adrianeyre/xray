using System.Collections.Generic;
using System.Globalization;

namespace Gradebook
{
    /// <summary>How an average becomes a grade.</summary>
    public interface IGradingScheme
    {
        string Name { get; }

        string Grade(Percentage average);
    }

    /// <summary>A to D by how high the average is, or F below all of them.</summary>
    public sealed class LetterScheme : IGradingScheme
    {
        private static readonly KeyValuePair<int, string>[] Boundaries =
        {
            new KeyValuePair<int, string>(850, "A"),
            new KeyValuePair<int, string>(700, "B"),
            new KeyValuePair<int, string>(550, "C"),
            new KeyValuePair<int, string>(400, "D"),
        };

        public string Name
        {
            get { return "Letter"; }
        }

        public string Grade(Percentage average)
        {
            foreach (KeyValuePair<int, string> boundary in Boundaries)
            {
                if (average >= new Percentage(boundary.Key))
                {
                    return boundary.Value;
                }
            }
            return "F";
        }
    }

    public sealed class PassFailScheme : IGradingScheme
    {
        private readonly Percentage passMark;

        public PassFailScheme(Percentage passMark)
        {
            this.passMark = passMark;
        }

        public string Name
        {
            get { return string.Format(CultureInfo.InvariantCulture, "Pass/fail at {0}", passMark); }
        }

        public string Grade(Percentage average)
        {
            return average >= passMark ? "Pass" : "Fail";
        }
    }
}
