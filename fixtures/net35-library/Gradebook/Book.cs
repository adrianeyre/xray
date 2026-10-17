using System;
using System.Collections.Generic;
using System.Linq;

namespace Gradebook
{
    public sealed class GradebookException : Exception
    {
        public GradebookException(string message)
            : base(message)
        {
        }
    }

    public sealed class MarkRecordedEventArgs : EventArgs
    {
        public MarkRecordedEventArgs(string student, int? mark)
        {
            Student = student;
            Mark = mark;
        }

        public string Student { get; private set; }

        public int? Mark { get; private set; }
    }

    /// <summary>The students of a year, found by name whatever its case, and their marks.</summary>
    public sealed class Book
    {
        private readonly Dictionary<string, Student> students =
            new Dictionary<string, Student>(StringComparer.OrdinalIgnoreCase);

        public event EventHandler<MarkRecordedEventArgs> MarkRecorded;

        public Student Enrol(string name, string form)
        {
            Student student = new Student(name) { Form = form };
            students.Add(name, student);
            return student;
        }

        public void Record(string name, params int?[] marks)
        {
            Student student = Find(name);
            foreach (int? mark in marks)
            {
                student.Marks.Add(mark);
                EventHandler<MarkRecordedEventArgs> handler = MarkRecorded;
                if (handler != null)
                {
                    handler(this, new MarkRecordedEventArgs(student.Name, mark));
                }
            }
        }

        public Student Find(string name)
        {
            Student student;
            if (!students.TryGetValue(name, out student))
            {
                throw new GradebookException("No student named " + name + ".");
            }
            return student;
        }

        /// <summary>Every student, by name.</summary>
        public IEnumerable<Student> Students
        {
            get { return students.Values.OrderBy(student => student.Name, StringComparer.Ordinal); }
        }
    }
}
