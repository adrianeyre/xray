using System;
using Greetings;

namespace MissingReference;

internal static class Program
{
    private static int Main(string[] args)
    {
        var name = args.Length > 0 ? args[0] : "world";
        Console.WriteLine(Greeter.Greet(name));
        return 0;
    }
}
