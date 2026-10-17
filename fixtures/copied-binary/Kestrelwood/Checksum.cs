using System.Text;

namespace Kestrelwood.Checksums
{
    /// <summary>The checksums this library computes.</summary>
    public enum Algorithm
    {
        Crc32,
        Adler32,
    }

    public interface IChecksum
    {
        string Name { get; }

        uint Compute(byte[] data);
    }

    /// <summary>A checksum of bytes; derive from it to add one of your own.</summary>
    public abstract class Checksum : IChecksum
    {
        public abstract string Name { get; }

        public abstract uint Compute(byte[] data);

        /// <summary>The checksum of a text's UTF-8 bytes, as eight hex digits.</summary>
        public string Hex(string text) => Compute(Encoding.UTF8.GetBytes(text)).ToString("x8");

        public override string ToString() => Name;

        public static Checksum Create(Algorithm algorithm)
        {
            switch (algorithm)
            {
                case Algorithm.Crc32:
                    return new Crc32();
                case Algorithm.Adler32:
                    return new Adler32();
                default:
                    throw new System.ArgumentOutOfRangeException(nameof(algorithm), algorithm, "No such checksum.");
            }
        }
    }

    public sealed class Crc32 : Checksum
    {
        private static readonly uint[] Table = MakeTable();

        public override string Name => "CRC-32";

        public override uint Compute(byte[] data)
        {
            uint crc = 0xFFFFFFFFu;
            foreach (byte b in data)
            {
                crc = Table[(crc ^ b) & 0xFF] ^ (crc >> 8);
            }
            return ~crc;
        }

        private static uint[] MakeTable()
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                uint c = n;
                for (int k = 0; k < 8; k++)
                {
                    c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                }
                table[n] = c;
            }
            return table;
        }
    }

    public sealed class Adler32 : Checksum
    {
        public const uint Modulus = 65521;

        public override string Name => "Adler-32";

        public override uint Compute(byte[] data)
        {
            uint a = 1, b = 0;
            foreach (byte d in data)
            {
                a = (a + d) % Modulus;
                b = (b + a) % Modulus;
            }
            return (b << 16) | a;
        }
    }
}
