using System;
using System.Text;
using Kestrelwood.Checksums;

namespace CopiedBinary;

/// <summary>A checksum of the program's own, derived from the library's base class.</summary>
internal sealed class ByteSum : Checksum
{
    public override string Name => "byte sum";

    public override uint Compute(byte[] data)
    {
        uint sum = 0;
        foreach (byte b in data)
        {
            sum += b;
        }
        return sum;
    }
}

internal static class Program
{
    private const string Usage =
        "Usage: CopiedBinary crc32|adler32|sum <text> | tag <text> | luhn <digits> | valid <number>";

    private static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine(Usage);
            return 1;
        }
        string text = args[1];
        try
        {
            switch (args[0])
            {
                case "crc32":
                case "adler32":
                    var algorithm = args[0] == "crc32" ? Algorithm.Crc32 : Algorithm.Adler32;
                    Print(Checksum.Create(algorithm), text);
                    return 0;
                case "sum":
                    Print(new ByteSum(), text);
                    return 0;
                case "tag":
                    Console.WriteLine(text.Tagged(new Crc32()));
                    Console.WriteLine(text.Tagged(new ByteSum()));
                    return 0;
                case "luhn":
                    Console.WriteLine($"{text}{Luhn.CheckDigit(text)} (mod {Luhn.Modulus})");
                    return 0;
                case "valid":
                    bool valid = Luhn.IsValid(text);
                    Console.WriteLine($"{text} is {(valid ? "valid" : "not valid")}");
                    return valid ? 0 : 3;
                default:
                    Console.Error.WriteLine(Usage);
                    return 1;
            }
        }
        catch (InvalidDigitException e)
        {
            Console.Error.WriteLine($"{e.Message} (position {e.Position})");
            return 2;
        }
    }

    private static void Print(IChecksum checksum, string text)
    {
        uint value = checksum.Compute(Encoding.UTF8.GetBytes(text));
        string hex = checksum is Checksum own ? own.Hex(text) : value.ToString("x8");
        Console.WriteLine($"{checksum.Name} of \"{text}\" = {hex} ({value})");
    }
}
