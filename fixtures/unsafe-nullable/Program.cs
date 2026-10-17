using System;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Fixtures.Pointers.Text;

namespace Fixtures.Pointers;

/// <summary>
/// Works on its operands with pointers, a fixed-size buffer, stackalloc and a
/// function pointer, all of which compile only with unsafe code allowed; looks
/// names up through nullable-annotated members; and describes itself: its
/// name, version and attributes, and the nullability its members were
/// compiled with. A Recovered Solution that lost any of those project
/// properties would not compile, or would describe itself differently.
/// </summary>
internal static unsafe class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int NotFound = 2;

    private const string Usage =
        "Usage: Xray.UnsafeNullable <assembly|nullability|sum|reverse|checksum|apply|find> [operands...]";

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
                case "assembly":
                    Describe(typeof(Program).Assembly);
                    return Succeeded;
                case "nullability":
                    Nullability.Print(typeof(Directory));
                    return Succeeded;
                case "sum":
                    Console.WriteLine($"sum = {Sum(Operands(args))}");
                    return Succeeded;
                case "reverse":
                    return Reverse(args);
                case "checksum":
                    return Checksum(args);
                case "apply":
                    return Apply(args);
                case "find":
                    return Find(args);
                default:
                    Console.Error.WriteLine($"Unknown command \"{args[0]}\".");
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (FormatException)
        {
            Console.Error.WriteLine("Operands must be integers.");
            return InvalidInput;
        }
        catch (OverflowException)
        {
            Console.Error.WriteLine("Operands must fit in an int.");
            return InvalidInput;
        }
    }

    /// <summary>
    /// The Assembly's full name, then every assembly and module attribute,
    /// sorted. Not <c>DebuggableAttribute</c>, which says how it was built
    /// (Debug or Release) rather than anything its source or project says.
    /// </summary>
    private static void Describe(Assembly assembly)
    {
        Console.WriteLine(assembly.GetName().FullName);
        var attributes =
            assembly.GetCustomAttributesData().Select(attribute => $"[assembly: {Shown(attribute)}]")
                .Concat(assembly.ManifestModule.GetCustomAttributesData().Select(attribute => $"[module: {Shown(attribute)}]"))
                .Where(line => !line.Contains("System.Diagnostics.DebuggableAttribute"))
                .OrderBy(line => line, StringComparer.Ordinal);
        foreach (var line in attributes)
        {
            Console.WriteLine(line);
        }
    }

    /// <summary><c>[Name(…)]</c> without its brackets.</summary>
    private static string Shown(CustomAttributeData attribute)
    {
        var text = attribute.ToString();
        return text.Substring(1, text.Length - 2);
    }

    private static int[] Operands(string[] args) =>
        args.Skip(1).Select(arg => int.Parse(arg, CultureInfo.InvariantCulture)).ToArray();

    /// <summary>Walks the operands with a pointer into a stackalloc'd copy of them.</summary>
    private static long Sum(int[] operands)
    {
        int* copy = stackalloc int[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            copy[i] = operands[i];
        }

        long sum = 0;
        for (int* p = copy, end = copy + operands.Length; p < end; p++)
        {
            sum += *p;
        }

        return sum;
    }

    /// <summary>Reverses a copy of the word in place, through a pinned pointer to its characters.</summary>
    private static int Reverse(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine("Usage: Xray.UnsafeNullable reverse <word>");
            return InvalidInput;
        }

        var characters = args[1].ToCharArray();
        fixed (char* first = characters)
        {
            for (int left = 0, right = characters.Length - 1; left < right; left++, right--)
            {
                (first[left], first[right]) = (first[right], first[left]);
            }
        }

        Console.WriteLine(new string(characters));
        return Succeeded;
    }

    /// <summary>A checksum of the operands' low bytes, kept in a fixed-size buffer.</summary>
    private static int Checksum(string[] args)
    {
        var operands = Operands(args);
        if (operands.Length > Block.Capacity)
        {
            Console.Error.WriteLine($"At most {Block.Capacity} operands fit in a block.");
            return InvalidInput;
        }

        var block = default(Block);
        foreach (var operand in operands)
        {
            block.Append(unchecked((byte)operand));
        }

        Console.WriteLine($"length {block.Length}, checksum {block.Checksum()}, sizeof(Block) = {sizeof(Block)}");
        return Succeeded;
    }

    /// <summary>Folds the operands, unchecked, with an operation chosen through a function pointer.</summary>
    private static int Apply(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: Xray.UnsafeNullable apply <add|multiply|max> [operands...]");
            return InvalidInput;
        }

        delegate*<long, long, long> operation;
        switch (args[1])
        {
            case "add":
                operation = &Add;
                break;
            case "multiply":
                operation = &Multiply;
                break;
            case "max":
                operation = &Math.Max;
                break;
            default:
                Console.Error.WriteLine($"Unknown operation \"{args[1]}\".");
                return InvalidInput;
        }

        var operands = Operands(args.Skip(1).ToArray());
        if (operands.Length == 0)
        {
            Console.Error.WriteLine("There is nothing to apply it to.");
            return InvalidInput;
        }

        long result = operands[0];
        for (var i = 1; i < operands.Length; i++)
        {
            result = operation(result, operands[i]);
        }

        Console.WriteLine($"{args[1]} = {result}");
        return Succeeded;
    }

    private static long Add(long left, long right) => left + right;

    private static long Multiply(long left, long right) => left * right;

    /// <summary>Looks each name up in the directory, which may know nothing of it.</summary>
    private static int Find(string[] args)
    {
        var directory = new Directory(("ada", "Ada Lovelace"), ("alan", "Alan Turing"), ("grace", null));
        var exitCode = Succeeded;
        foreach (var name in args.Skip(1))
        {
            if (directory.TryFind(name, out var entry))
            {
                Console.WriteLine($"{name}: {entry.FullName ?? "(no full name)"}");
            }
            else
            {
                Console.WriteLine($"{name}: not found");
                exitCode = NotFound;
            }
        }

        Console.WriteLine($"last found: {directory.LastFound?.Key ?? "(none)"}");
        return exitCode;
    }
}
