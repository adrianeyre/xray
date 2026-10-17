using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Microsoft.Build.Framework;
using Microsoft.Build.Utilities;

/// <summary>
/// Writes the benchmark Fixture's source as it is built: <see cref="Modules"/>
/// namespaces, <c>Ledgerworks.Module00</c> on, each of <see cref="TypesPerModule"/>
/// slots that cycle through eight kinds of type, a file for each slot, and a
/// <c>Catalog</c> per namespace that computes every one of its types, which
/// <c>Modules.Run</c> calls for <c>Program</c>. What each type computes
/// differs only by the constants its number gives it, so the source is the
/// same on every build and every OS.
/// </summary>
public class GenerateModules : Task
{
    [Required]
    public string OutputDirectory { get; set; } = "";

    [Required]
    public int Modules { get; set; }

    [Required]
    public int TypesPerModule { get; set; }

    [Output]
    public ITaskItem[] Files { get; set; } = Array.Empty<ITaskItem>();

    private const string Usings =
        "using System;\n" +
        "using System.Collections.Generic;\n" +
        "using System.Globalization;\n" +
        "using System.Linq;\n" +
        "using System.Text;\n" +
        "using System.Threading.Tasks;\n";

    public override bool Execute()
    {
        Directory.CreateDirectory(OutputDirectory);
        var files = new List<ITaskItem>();
        var modules = new StringBuilder();
        modules.Append("namespace Ledgerworks;\n\npublic static class Modules\n{\n");
        modules.Append("    public const int Count = " + Modules + ";\n\n");
        modules.Append("    public static int Run(int module, int seed) => module switch\n    {\n");
        for (var module = 0; module < Modules; module++)
        {
            var ns = "Ledgerworks.Module" + module.ToString("00");
            var catalog = new StringBuilder();
            catalog.Append(Usings + "\nnamespace " + ns + ";\n\npublic static class Catalog\n{\n");
            catalog.Append("    public static int Run(int seed)\n    {\n        int total = 0;\n");
            for (var slot = 0; slot < TypesPerModule; slot++)
            {
                var number = module * TypesPerModule + slot;
                var (file, compute) = Type(number);
                files.Add(Write(Path.Combine("Module" + module.ToString("00"), file + ".cs"), Usings + "\nnamespace " + ns + ";\n\n" + Fill(Templates[number % Templates.Length], number)));
                catalog.Append("        total = unchecked(total * 31 + " + compute + "(seed + " + slot + "));\n");
            }

            catalog.Append("        return total;\n    }\n}\n");
            files.Add(Write(Path.Combine("Module" + module.ToString("00"), "Catalog.cs"), catalog.ToString()));
            modules.Append("        " + module + " => " + ns + ".Catalog.Run(seed),\n");
        }

        modules.Append("        _ => throw new System.ArgumentOutOfRangeException(nameof(module)),\n    };\n}\n");
        files.Add(Write("Modules.cs", modules.ToString()));
        Files = files.ToArray();
        return true;
    }

    private ITaskItem Write(string relative, string code)
    {
        var path = Path.Combine(OutputDirectory, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // Left alone when it is already so, so the compiler is not run again for nothing.
        if (!File.Exists(path) || File.ReadAllText(path) != code)
        {
            File.WriteAllText(path, code);
        }

        return new TaskItem(path);
    }

    /// <summary>The file a type number is declared in, and the method its Catalog computes it with.</summary>
    private static (string File, string Compute) Type(int number)
    {
        var name = Names[number % Names.Length] + number;
        return (number % Templates.Length) switch
        {
            2 => (name, "Shape" + number + ".Compute"),
            3 => (name, "ModeRules" + number + ".Compute"),
            5 => (name, name + "<int, string>.Compute"),
            _ => (name, name + ".Compute"),
        };
    }

    private static readonly string[] Names = { "Ledger", "Vector", "Shape", "Mode", "Entry", "Cache", "Pipeline", "Account" };

    /// <summary>A template with its number, and the constants it gives, filled in.</summary>
    private static string Fill(string template, int number) =>
        template
            .Replace("@RULES", Rules)
            .Replace("@I", number.ToString())
            .Replace("@K1", (number % 97 + 3).ToString())
            .Replace("@K2", (number % 89 + 11).ToString())
            .Replace("@N", (number % 13 + 24).ToString())
            .Replace("@S", "\"@L\"")
            .Replace("@L", Names[number % Names.Length].ToLowerInvariant() + "-" + number);

    /// <summary>
    /// Rules every type has, before its Compute, which adds their tally: a
    /// switch on strings, a chain of checks, each with its own message, and a
    /// loop over codes, which is what most of an application's size is.
    /// </summary>
    private const string Rules = @"    private static readonly string[] Codes = { ""alpha"", ""bravo"", ""charlie"", ""delta"", ""echo"", ""foxtrot"", ""golf"", ""hotel"", ""india"", ""juliet"", ""kilo"", ""lima"", ""unknown-@I"" };

    public static int Rate(string code)
    {
        switch (code)
        {
            case ""alpha"":
                return @K1;
            case ""bravo"":
                return @K2;
            case ""charlie"":
                return @K1 + @K2;
            case ""delta"":
                return @K1 * 2;
            case ""echo"":
                return @K2 * 3;
            case ""foxtrot"":
                return @N;
            case ""golf"":
                return @N * @K1;
            case ""hotel"":
                return @K2 - @K1;
            case ""india"":
                return 7;
            case ""juliet"":
                return 11;
            case ""kilo"":
                return 13 * @K1;
            case ""lima"":
                return 17 * @K2;
            default:
                return code.Length;
        }
    }

    public static string Validate(int value)
    {
        if (value < -@K2 * 10)
        {
            return ""@L: the value is far below the lowest the rules of this type allow."";
        }
        if (value < 0)
        {
            return ""@L: the value is below zero, which the rules of this type do not allow."";
        }
        if (value == 0)
        {
            return ""@L: the value is zero, which the rules of this type treat as missing."";
        }
        if (value % @K1 == 0)
        {
            return ""@L: the value is a multiple of its first constant, so it is rounded."";
        }
        if (value % @K2 == 0)
        {
            return ""@L: the value is a multiple of its second constant, so it is halved."";
        }
        if (value > @K1 * @K2 * 10)
        {
            return ""@L: the value is far above the highest the rules of this type allow."";
        }
        if (value > @K1 * @K2)
        {
            return ""@L: the value is above the highest the rules of this type allow."";
        }
        return ""@L: the value is within the rules of this type."";
    }

    public static int Tally(int seed)
    {
        int tally = 0;
        for (int i = 0; i < Codes.Length; i++)
        {
            string code = Codes[(i + Math.Abs(seed % Codes.Length)) % Codes.Length];
            int rate = Rate(code);
            string verdict = Validate(seed * (i + 1) - rate);
            tally = unchecked(tally * 13 + rate + verdict.Length + verdict[verdict.Length - 2]);
        }
        return tally;
    }

";

    private static readonly string[] Templates =
    {
        // A class: fields, a constructor, properties, loops, a switch, LINQ, a dictionary, try/catch/finally and interpolation.
        @"public sealed class Ledger@I
{
    private readonly int[] _values;
    private readonly Dictionary<string, int> _totals = new Dictionary<string, int>();

    public Ledger@I(int seed)
    {
        _values = new int[@N];
        for (int i = 0; i < _values.Length; i++)
        {
            _values[i] = unchecked(seed * (i + @K1) + @K2) % 1000;
        }
    }

    public int Count => _values.Length;

    public string Name { get; set; } = @S;

    public int Sum()
    {
        int total = 0;
        foreach (int value in _values)
        {
            total += value;
        }
        return total;
    }

    public int Classify(int value)
    {
        switch (value % 7)
        {
            case 0:
                return value * 3;
            case 1:
                return value - @K1;
            case 2:
            case 3:
                return value / 2;
            case 4:
                return -value;
            default:
                return value + @K2;
        }
    }

    public int Query()
    {
        return _values
            .Where(v => v % 3 != 0)
            .Select(v => Classify(v))
            .OrderBy(v => v)
            .Take(@N / 2)
            .Aggregate(0, (acc, v) => unchecked(acc * 31 + v));
    }

    public void Record(string key, int amount)
    {
        if (_totals.TryGetValue(key, out int existing))
        {
            _totals[key] = existing + amount;
        }
        else
        {
            _totals.Add(key, amount);
        }
    }

    public int Settle()
    {
        for (int i = 0; i < _values.Length; i++)
        {
            Record(""k"" + (i % 5).ToString(CultureInfo.InvariantCulture), _values[i]);
        }
        int result = 0;
        foreach (KeyValuePair<string, int> pair in _totals.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            result = unchecked(result * 17 + pair.Value + pair.Key.Length);
        }
        return result;
    }

    public int Guarded(int divisor)
    {
        try
        {
            return Sum() / divisor;
        }
        catch (DivideByZeroException)
        {
            return -1;
        }
        finally
        {
            _totals.Clear();
        }
    }

    public string Describe()
    {
        return $""{Name}: {Count} values, sum {Sum().ToString(CultureInfo.InvariantCulture)}"";
    }

@RULES
    public static int Compute(int seed)
    {
        Ledger@I ledger = new Ledger@I(seed);
        int result = ledger.Sum() ^ ledger.Query();
        result = unchecked(result + ledger.Settle() + ledger.Guarded(seed % 3) + ledger.Describe().Length + Tally(seed));
        return result;
    }
}
",
        // A struct: properties, operators, equality and a loop.
        @"public readonly struct Vector@I : IEquatable<Vector@I>
{
    public Vector@I(int x, int y, int z)
    {
        X = x;
        Y = y;
        Z = z;
    }

    public int X { get; }

    public int Y { get; }

    public int Z { get; }

    public static Vector@I operator +(Vector@I a, Vector@I b) => new Vector@I(a.X + b.X, a.Y + b.Y, a.Z + b.Z);

    public static Vector@I operator *(Vector@I a, int k) => new Vector@I(a.X * k, a.Y * k, a.Z * k);

    public static bool operator ==(Vector@I a, Vector@I b) => a.Equals(b);

    public static bool operator !=(Vector@I a, Vector@I b) => !a.Equals(b);

    public int Dot(Vector@I other) => X * other.X + Y * other.Y + Z * other.Z;

    public Vector@I Cross(Vector@I o) => new Vector@I(Y * o.Z - Z * o.Y, Z * o.X - X * o.Z, X * o.Y - Y * o.X);

    public Vector@I Clamp(int limit)
    {
        int x = X > limit ? limit : X < -limit ? -limit : X;
        int y = Y > limit ? limit : Y < -limit ? -limit : Y;
        int z = Z > limit ? limit : Z < -limit ? -limit : Z;
        return new Vector@I(x, y, z);
    }

    public bool Equals(Vector@I other) => X == other.X && Y == other.Y && Z == other.Z;

    public override bool Equals(object? obj) => obj is Vector@I other && Equals(other);

    public override int GetHashCode() => unchecked((X * 397) ^ (Y * 31) ^ Z);

    public override string ToString() => ""("" + X.ToString(CultureInfo.InvariantCulture) + "", "" + Y.ToString(CultureInfo.InvariantCulture) + "", "" + Z.ToString(CultureInfo.InvariantCulture) + "")"";

@RULES
    public static int Compute(int seed)
    {
        Vector@I a = new Vector@I(seed, @K1, seed % @K2);
        Vector@I b = new Vector@I(@K2, seed / 3, -seed);
        Vector@I sum = default;
        for (int i = 0; i < @N; i++)
        {
            sum = (sum + a * i + b.Cross(a)).Clamp(100000);
            if (sum == a)
            {
                sum = b;
            }
        }
        return unchecked(sum.Dot(a) + sum.GetHashCode() + sum.ToString().Length + Tally(seed));
    }
}
",
        // An interface, and a class implementing it and IComparable, sorted.
        @"public interface IShape@I
{
    int Area { get; }

    int Perimeter { get; }

    int Scale(int factor);
}

public sealed class Shape@I : IShape@I, IComparable<Shape@I>
{
    public Shape@I(int width, int height)
    {
        Width = width;
        Height = height;
    }

    public int Width { get; }

    public int Height { get; }

    public int Area => Width * Height;

    public int Perimeter => 2 * (Width + Height);

    public int Scale(int factor) => Area * factor * factor;

    public int CompareTo(Shape@I? other) => other is null ? 1 : Area.CompareTo(other.Area);

@RULES
    public static int Compute(int seed)
    {
        List<Shape@I> shapes = new List<Shape@I>();
        for (int i = 1; i <= @N; i++)
        {
            shapes.Add(new Shape@I((seed + i * @K1) % 50 + 1, (i * @K2) % 40 + 1));
        }
        shapes.Sort();
        IShape@I largest = shapes[shapes.Count - 1];
        int total = 0;
        foreach (IShape@I shape in shapes)
        {
            total = unchecked(total + shape.Scale(2) - shape.Perimeter);
        }
        return unchecked(total + largest.Area + Tally(seed));
    }
}
",
        // An enum, and extension methods switching on it.
        @"public enum Mode@I
{
    Idle,
    Running = 3,
    Paused,
    Stopped = 10,
}

public static class ModeRules@I
{
    public static Mode@I Next(this Mode@I mode) => mode switch
    {
        Mode@I.Idle => Mode@I.Running,
        Mode@I.Running => Mode@I.Paused,
        Mode@I.Paused => Mode@I.Stopped,
        _ => Mode@I.Idle,
    };

    public static int Weight(this Mode@I mode, int seed)
    {
        if (mode == Mode@I.Idle)
        {
            return seed % @K1;
        }
        else if (mode == Mode@I.Running)
        {
            return seed * 2 + @K2;
        }
        else if (mode == Mode@I.Paused)
        {
            return seed - @K1;
        }
        return (int)mode * @K2;
    }

@RULES
    public static int Compute(int seed)
    {
        Mode@I mode = (Mode@I)(Math.Abs(seed) % 4 == 0 ? 0 : 3);
        int total = 0;
        for (int i = 0; i < @N; i++)
        {
            total = unchecked(total + mode.Weight(seed + i) + mode.ToString().Length);
            mode = mode.Next();
        }
        return unchecked(total + Tally(seed));
    }
}
",
        // A record: with, equality, grouping and its generated ToString.
        @"public sealed record Entry@I(string Name, int Amount)
{
    public int Doubled => Amount * 2;

    public Entry@I Add(int amount) => this with { Amount = Amount + amount };

@RULES
    public static int Compute(int seed)
    {
        List<Entry@I> entries = new List<Entry@I>();
        for (int i = 0; i < @N; i++)
        {
            entries.Add(new Entry@I(""e"" + (i % 4).ToString(CultureInfo.InvariantCulture), (seed + i * @K1) % 100));
        }
        int total = 0;
        foreach (IGrouping<string, Entry@I> group in entries.GroupBy(e => e.Name).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            Entry@I sum = group.Aggregate(new Entry@I(group.Key, 0), (acc, e) => acc.Add(e.Amount));
            total = unchecked(total * 7 + sum.Doubled + sum.Name.Length);
        }
        Entry@I first = entries[0];
        Entry@I copy = first with { };
        if (copy == first && !ReferenceEquals(copy, first))
        {
            total += @K2;
        }
        return unchecked(total + first.ToString().Length + Tally(seed));
    }
}
",
        // A generic class: constraints, a delegate and its own static method.
        @"public sealed class Cache@I<TKey, TValue>
    where TKey : notnull
{
    private readonly Dictionary<TKey, TValue> _items = new Dictionary<TKey, TValue>();

    public int Misses { get; private set; }

    public int Count => _items.Count;

    public TValue GetOrAdd(TKey key, Func<TKey, TValue> create)
    {
        if (!_items.TryGetValue(key, out TValue? value))
        {
            Misses++;
            value = create(key);
            _items[key] = value;
        }
        return value;
    }

    public IEnumerable<TValue> Values => _items.Values;

@RULES
    public static int Compute(int seed)
    {
        Cache@I<int, string> cache = new Cache@I<int, string>();
        int length = 0;
        for (int i = 0; i < @N * 2; i++)
        {
            string text = cache.GetOrAdd((seed + i * @K1) % @N, key => ""v"" + (key * @K2).ToString(CultureInfo.InvariantCulture));
            length += text.Length;
        }
        return unchecked(length * 31 + cache.Misses * @K1 + cache.Values.Count() + Tally(seed));
    }
}
",
        // async/await: a loop of awaits and Task.WhenAll.
        @"public static class Pipeline@I
{
    public static async Task<int> StageAsync(int value)
    {
        await Task.Yield();
        return unchecked(value * @K1) % 1000;
    }

    public static async Task<int> RunAsync(int seed)
    {
        int total = 0;
        for (int i = 0; i < @N / 4; i++)
        {
            total += await StageAsync(seed + i);
        }
        int[] results = await Task.WhenAll(Enumerable.Range(0, 4).Select(i => StageAsync(seed * i + @K2)));
        return total + results.Sum();
    }

@RULES
    public static int Compute(int seed) => unchecked(RunAsync(seed).GetAwaiter().GetResult() + Tally(seed));
}
",
        // A class with an event, an iterator, a local function, a StringBuilder and an exception.
        @"public class Account@I
{
    private int _balance;

    public event EventHandler<int>? Changed;

    public int Balance => _balance;

    public void Deposit(int amount)
    {
        if (amount <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(amount));
        }
        _balance += amount;
        Changed?.Invoke(this, _balance);
    }

    public IEnumerable<int> Steps(int count)
    {
        for (int i = 0; i < count; i++)
        {
            if (i * @K1 % 11 == 10)
            {
                yield break;
            }
            yield return i * @K2;
        }
    }

    public string Statement()
    {
        StringBuilder builder = new StringBuilder();
        foreach (int step in Steps(@N))
        {
            builder.Append(step.ToString(CultureInfo.InvariantCulture)).Append(';');
        }
        return builder.ToString();
    }

@RULES
    public static int Compute(int seed)
    {
        Account@I account = new Account@I();
        int seen = 0;
        account.Changed += (sender, balance) => seen = unchecked(seen + balance);
        int Twice(int value) => value * 2;
        foreach (int step in account.Steps(@N))
        {
            account.Deposit(Twice(step) + Math.Abs(seed % 7) + 1);
        }
        try
        {
            account.Deposit(0);
        }
        catch (ArgumentOutOfRangeException exception)
        {
            seen += exception.ParamName?.Length ?? 0;
        }
        return unchecked(seen + account.Balance + account.Statement().Length + Tally(seed));
    }
}
",
    };
}
