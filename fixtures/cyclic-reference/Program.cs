using System;
using Plugin;

namespace CyclicReference;

internal sealed class Program : IHost
{
    public string Name => "the host";

    private static int Main()
    {
        Console.WriteLine(Greeter.Greet(new Program()));
        return 0;
    }
}
