using System;
using System.Globalization;
using System.Reflection;
using System.Runtime.Versioning;
using System.Text;

namespace NetCoreApp31Console
{
    /// <summary>
    /// Says which framework it was built for, and does a little work with the
    /// base class library that the framework decides. Doubles show the
    /// framework most plainly: .NET Core 3.0 and later format them as the
    /// shortest string that round-trips, so 0.1 + 0.2 prints as
    /// 0.30000000000000004, where .NET Framework prints 0.3. A Recovered
    /// Solution that changed the framework would behave differently.
    /// </summary>
    internal static class Program
    {
        private const int Succeeded = 0;
        private const int InvalidInput = 1;
        private const int Overflowed = 3;

        private const string Usage = "Usage: NetCoreApp31Console <framework|add|sum|words> [operands...]";

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
                return args[0] switch
                {
                    "framework" => Framework(),
                    "add" => Add(args),
                    "sum" => Sum(args),
                    "words" => Words(args),
                    _ => Unknown(args[0]),
                };
            }
            catch (FormatException)
            {
                // Not the exception's message, which differs between runtimes.
                Console.Error.WriteLine("Operands must be numbers.");
                return InvalidInput;
            }
            catch (OverflowException)
            {
                Console.Error.WriteLine("The sum overflowed.");
                return Overflowed;
            }
        }

        /// <summary>Prints the framework this Assembly was built for, as its TargetFrameworkAttribute records it.</summary>
        private static int Framework()
        {
            TargetFrameworkAttribute? attribute = typeof(Program).Assembly.GetCustomAttribute<TargetFrameworkAttribute>();
            Console.WriteLine(attribute?.FrameworkName ?? "(none)");
            return Succeeded;
        }

        private static int Add(string[] args)
        {
            if (args.Length != 3)
            {
                Console.Error.WriteLine("Usage: NetCoreApp31Console add <left> <right>");
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

        private static int Words(string[] args)
        {
            string[] words = args[1..];
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
            return Succeeded;
        }

        private static int Unknown(string command)
        {
            Console.Error.WriteLine("Unknown command \"" + command + "\".");
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }
    }
}
