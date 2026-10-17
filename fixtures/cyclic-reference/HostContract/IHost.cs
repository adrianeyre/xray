namespace CyclicReference;

/// <summary>What the plugin asks of the program that loads it.</summary>
public interface IHost
{
    string Name { get; }
}
