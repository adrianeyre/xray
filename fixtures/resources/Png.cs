using System;
using System.Buffers.Binary;
using System.Linq;

namespace Phrasebook;

/// <summary>What a PNG's header says it is, and a checksum of all of it.</summary>
internal static class Png
{
    private static readonly byte[] Signature = [0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A];

    public static string Describe(byte[] bytes)
    {
        if (bytes.Length < 24 || !bytes.Take(Signature.Length).SequenceEqual(Signature))
        {
            return $"{bytes.Length} bytes, not a PNG";
        }

        var width = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
        var height = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
        return $"{width}x{height} PNG, {bytes.Length} bytes, FNV-1a {Fnv1a(bytes):x8}";
    }

    private static uint Fnv1a(byte[] bytes)
    {
        var hash = 2166136261;
        foreach (var b in bytes)
        {
            hash = unchecked((hash ^ b) * 16777619);
        }

        return hash;
    }
}
