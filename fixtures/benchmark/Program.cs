using System;
using System.Globalization;

namespace Ledgerworks;

/// <summary>
/// Computes every generated type of every module from a seed, printing what
/// each module's types came to, then the total, so a Recovered Solution that
/// changed what any one of them does prints something else.
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length != 1 || !int.TryParse(args[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out int seed))
        {
            Console.Error.WriteLine("Usage: Ledgerworks <seed>");
            return 2;
        }

        int total = 0;
        for (int module = 0; module < Modules.Count; module++)
        {
            int value = Modules.Run(module, seed);
            Console.WriteLine("Module" + module.ToString("00", CultureInfo.InvariantCulture) + ": " + value.ToString(CultureInfo.InvariantCulture));
            total = unchecked(total * 31 + value);
        }

        Console.WriteLine("Total: " + total.ToString(CultureInfo.InvariantCulture));
        return 0;
    }
}
