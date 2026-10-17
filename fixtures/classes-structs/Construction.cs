using System;

namespace ClassesStructs;

/// <summary>
/// Says when it is initialized and constructed. Its constructor calls a
/// virtual method, which a derived class overrides before its own
/// constructor has run.
/// </summary>
public class Base
{
    static Base()
    {
        Console.WriteLine("  static Base()");
    }

    public Base()
    {
        Console.WriteLine($"  Base() sees {Describe()}");
    }

    public virtual string Describe() => "Base";

    public string Greet() => "Base.Greet";
}

/// <summary>
/// Its field initializer runs before Base's constructor, its constructor's
/// body after: the virtual call from Base() sees the one but not the other.
/// </summary>
public class Derived : Base
{
    private readonly string initialized = "initialized";
    private string? assigned;

    static Derived()
    {
        Console.WriteLine("  static Derived()");
    }

    public Derived()
    {
        assigned = "assigned";
        Console.WriteLine($"  Derived() sees {Describe()}");
    }

    public override string Describe() => $"Derived({initialized}, {assigned ?? "unassigned"})";

    public new string Greet() => "Derived.Greet";
}

/// <summary>Seals the override it inherits.</summary>
public class MostDerived : Derived
{
    public MostDerived()
        : base()
    {
        Console.WriteLine("  MostDerived()");
    }

    public sealed override string Describe() => "Most" + base.Describe();
}
