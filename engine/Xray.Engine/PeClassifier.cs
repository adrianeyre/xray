using System.Buffers.Binary;
using System.Reflection.PortableExecutable;

namespace Xray.Engine;

/// <summary>What a file is, judged by its PE headers.</summary>
internal enum InputKind
{
    /// <summary>A PE file with a CLI header: .NET IL and metadata.</summary>
    ManagedAssembly,

    /// <summary>A PE file without a CLI header: machine code only.</summary>
    NativeExecutable,

    /// <summary>Not a PE file at all.</summary>
    NotPe,
}

/// <summary>Why a file is not a PE file.</summary>
internal enum NotPeReason
{
    /// <summary>It does not start with the "MZ" signature of an MS-DOS header.</summary>
    NoDosHeader,

    /// <summary>It has an MS-DOS header but no "PE\0\0" signature where that header points.</summary>
    NoPeHeader,

    /// <summary>It has a PE signature, but the headers after it are truncated or corrupt.</summary>
    MalformedPeHeaders,
}

/// <param name="Machine">The PE header's machine type, for a PE file.</param>
/// <param name="Reason">Why it is not a PE file, for <see cref="InputKind.NotPe"/>.</param>
internal sealed record Classification(InputKind Kind, Machine? Machine = null, NotPeReason? Reason = null);

/// <summary>
/// Tells a Managed Assembly from a Native Executable from a file that is not PE
/// at all. Only the headers are read, so any file, however large, is cheap.
/// </summary>
internal static class PeClassifier
{
    private const int DosHeaderSize = 64;
    // Where the MS-DOS header keeps the offset of the PE signature (e_lfanew).
    private const int PeSignatureOffsetField = 0x3C;
    private const uint PeSignature = 0x00004550; // "PE\0\0", little-endian.

    public static Classification Classify(string path)
    {
        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        return Classify(stream);
    }

    public static Classification Classify(Stream stream)
    {
        var dosHeader = new byte[DosHeaderSize];
        var read = stream.ReadAtLeast(dosHeader, dosHeader.Length, throwOnEndOfStream: false);
        if (read < 2 || dosHeader[0] != (byte)'M' || dosHeader[1] != (byte)'Z')
        {
            return new Classification(InputKind.NotPe, Reason: NotPeReason.NoDosHeader);
        }

        // Checked by hand first: given a file without an MS-DOS header, PEReader
        // tries to read it as a COFF object file instead, and plenty of random
        // bytes pass for one.
        if (read < DosHeaderSize || !HasPeSignature(stream, BinaryPrimitives.ReadInt32LittleEndian(dosHeader.AsSpan(PeSignatureOffsetField))))
        {
            return new Classification(InputKind.NotPe, Reason: NotPeReason.NoPeHeader);
        }

        stream.Position = 0;
        using var reader = new PEReader(stream, PEStreamOptions.LeaveOpen);
        PEHeaders headers;
        try
        {
            headers = reader.PEHeaders;
        }
        catch (BadImageFormatException)
        {
            return new Classification(InputKind.NotPe, Reason: NotPeReason.MalformedPeHeaders);
        }

        if (headers.PEHeader is null)
        {
            return new Classification(InputKind.NotPe, Reason: NotPeReason.MalformedPeHeaders);
        }

        var machine = headers.CoffHeader.Machine;
        return headers.CorHeader is null
            ? new Classification(InputKind.NativeExecutable, machine)
            : new Classification(InputKind.ManagedAssembly, machine);
    }

    private static bool HasPeSignature(Stream stream, int offset)
    {
        if (offset < 0 || offset > stream.Length - sizeof(uint))
        {
            return false;
        }

        stream.Position = offset;
        var signature = new byte[sizeof(uint)];
        return stream.ReadAtLeast(signature, signature.Length, throwOnEndOfStream: false) == signature.Length
            && BinaryPrimitives.ReadUInt32LittleEndian(signature) == PeSignature;
    }
}
