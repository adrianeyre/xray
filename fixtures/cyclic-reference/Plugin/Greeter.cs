using CyclicReference;

namespace Plugin;

public static class Greeter
{
    public static string Greet(IHost host) => $"Hello from the plugin, {host.Name}!";
}
