using System;
using System.Collections.Generic;
using System.Linq;

namespace Gradebook
{
    /// <summary>How a student stands: none, any or all of these at once.</summary>
    [Flags]
    public enum Standing
    {
        None = 0,
        Honours = 1,
        Improving = 2,
        AtRisk = 4,
    }

    public sealed class Student
    {
        // A null mark is a test the student missed.
        private readonly List<int?> marks = new List<int?>();

        public Student(string name)
        {
            Name = name;
        }

        public string Name { get; private set; }

        public string Form { get; set; }

        public IList<int?> Marks
        {
            get { return marks; }
        }

        /// <summary>The marks of every test the student sat, in order.</summary>
        public IEnumerable<int> Sat()
        {
            foreach (int? mark in marks)
            {
                if (mark.HasValue)
                {
                    yield return mark.Value;
                }
            }
        }

        public int Missed
        {
            get { return marks.Count(mark => !mark.HasValue); }
        }
    }
}
