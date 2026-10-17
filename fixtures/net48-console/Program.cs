using System;
using System.Globalization;
using System.Reflection;
using System.Runtime.Versioning;
using System.Text;

namespace Net48Console
{
    /// <summary>
    /// Says which framework it was built for, and does a little work with the
    /// base class library that the framework decides. Doubles show the
    /// framework most plainly: .NET Framework formats them to 15 significant
    /// digits, so 0.1 + 0.2 prints as 0.3, where .NET Core 3.0 and later print
    /// the shortest string that round-trips, 0.30000000000000004. A Recovered
    /// Solution that changed the framework would behave differently.
    /// </summary>
    internal static class Program
    {
        private const int Succeeded = 0;
        private const int InvalidInput = 1;
        private const int Overflowed = 3;

        private const string Usage = "Usage: Net48Console <framework|add|sum|words> [operands...]";

        private static int Main(string[] args)
        {
            // The output must not depend on the culture of the machine running it.
            CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

            if (args.Length == 0)
            {
                Console.Error.WriteLine(Usage);
                return InvalidInput;
            }

            try
            {
                switch (args[0])
                {
                    case "framework":
                        Console.WriteLine(TargetFramework());
                        return Succeeded;
                    case "add":
                        return Add(args);
                    case "sum":
                        return Sum(args);
                    case "words":
                        Words(args);
                        return Succeeded;
                    default:
                        Console.Error.WriteLine("Unknown command \"" + args[0] + "\".");
                        Console.Error.WriteLine(Usage);
                        return InvalidInput;
                }
            }
            catch (FormatException)
            {
                // Not the exception's message, which differs between frameworks.
                Console.Error.WriteLine("Operands must be numbers.");
                return InvalidInput;
            }
            catch (OverflowException)
            {
                Console.Error.WriteLine("The sum overflowed.");
                return Overflowed;
            }
        }

        /// <summary>The framework this Assembly was built for, as its TargetFrameworkAttribute records it.</summary>
        private static string TargetFramework()
        {
            var attribute = typeof(Program).Assembly.GetCustomAttribute<TargetFrameworkAttribute>();
            return attribute == null ? "(none)" : attribute.FrameworkName;
        }

        private static int Add(string[] args)
        {
            if (args.Length != 3)
            {
                Console.Error.WriteLine("Usage: Net48Console add <left> <right>");
                return InvalidInput;
            }

            double left = double.Parse(args[1], CultureInfo.InvariantCulture);
            double right = double.Parse(args[2], CultureInfo.InvariantCulture);
            double sum = left + right;
            Console.WriteLine(left + " + " + right + " = " + sum);
            Console.WriteLine("exactly " + sum.ToString("R", CultureInfo.InvariantCulture));
            return Succeeded;
        }

        private static int Sum(string[] args)
        {
            int total = 0;
            for (int i = 1; i < args.Length; i++)
            {
                total = checked(total + int.Parse(args[i], CultureInfo.InvariantCulture));
            }

            Console.WriteLine(string.Format(CultureInfo.InvariantCulture, "sum of {0} = {1}", args.Length - 1, total));
            return Succeeded;
        }

        private static void Words(string[] args)
        {
            var words = new string[args.Length - 1];
            Array.Copy(args, 1, words, 0, words.Length);
            Array.Sort(words, StringComparer.Ordinal);

            var line = new StringBuilder();
            foreach (string word in words)
            {
                if (line.Length > 0)
                {
                    line.Append(' ');
                }

                line.Append(word.ToUpperInvariant());
            }

            Console.WriteLine(words.Length + " words: " + line);
        }
    }
}
