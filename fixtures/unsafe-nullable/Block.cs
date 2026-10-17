namespace Fixtures.Pointers;

/// <summary>Up to <see cref="Capacity"/> bytes, held in a fixed-size buffer.</summary>
internal unsafe struct Block
{
    public const int Capacity = 16;

    private fixed byte bytes[Capacity];

    public int Length { get; private set; }

    public void Append(byte value)
    {
        bytes[Length] = value;
        Length++;
    }

    /// <summary>Fletcher-16, over the bytes appended so far.</summary>
    public readonly int Checksum()
    {
        int low = 0, high = 0;
        fixed (byte* first = bytes)
        {
            for (var p = first; p < first + Length; p++)
            {
                low = (low + *p) % 255;
                high = (high + low) % 255;
            }
        }

        return (high << 8) | low;
    }
}
