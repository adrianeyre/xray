using System.Reflection.PortableExecutable;
using System.Text;

namespace Xray.Engine.Tests;

public class PeClassifierTests
{
    /// <summary>The native Fixture (fixtures/native), copied beside the tests.</summary>
    internal static readonly string NativeExecutable = Path.Combine(AppContext.BaseDirectory, "Fixtures", "hello.exe");

    /// <summary>The engine itself, which is a Managed Assembly.</summary>
    internal static readonly string ManagedAssembly = typeof(Session).Assembly.Location;

    private static Classification Classify(byte[] bytes) => PeClassifier.Classify(new MemoryStream(bytes));

    private static byte[] Prefix(string path, int length) => File.ReadAllBytes(path)[..length];

    /// <summary>An MS-DOS header whose e_lfanew points at <paramref name="peOffset"/>, padded to <paramref name="length"/>.</summary>
    private static byte[] DosHeader(int peOffset, int length = 128)
    {
        var bytes = new byte[length];
        bytes[0] = (byte)'M';
        bytes[1] = (byte)'Z';
        BitConverter.TryWriteBytes(bytes.AsSpan(0x3C), peOffset);
        return bytes;
    }

    [Fact]
    public void AnAssemblyWithACliHeaderIsAManagedAssembly()
    {
        var classification = PeClassifier.Classify(ManagedAssembly);

        Assert.Equal(InputKind.ManagedAssembly, classification.Kind);
        Assert.NotNull(classification.Machine);
        Assert.Null(classification.Reason);
    }

    [Fact]
    public void ThePrebuiltNativeFixtureIsAnX64NativeExecutable()
    {
        Assert.Equal(
            new Classification(InputKind.NativeExecutable, Machine.Amd64),
            PeClassifier.Classify(NativeExecutable));
    }

    [Theory]
    [InlineData("")]
    [InlineData("M")]
    [InlineData("Hello, world.\n")]
    [InlineData("mz lower case is not a signature")]
    public void TextIsNotAPeFile(string text)
    {
        Assert.Equal(
            new Classification(InputKind.NotPe, Reason: NotPeReason.NoDosHeader),
            Classify(Encoding.UTF8.GetBytes(text)));
    }

    [Fact]
    public void RandomBytesAreNotAPeFile()
    {
        var bytes = new byte[4096];
        new Random(8).NextBytes(bytes);
        Assert.False(bytes[0] == 'M' && bytes[1] == 'Z');

        Assert.Equal(NotPeReason.NoDosHeader, Classify(bytes).Reason);
    }

    [Fact]
    public void AnElfExecutableIsNotAPeFile()
    {
        byte[] elf = [0x7F, (byte)'E', (byte)'L', (byte)'F', 2, 1, 1, 0, .. new byte[56]];

        Assert.Equal(NotPeReason.NoDosHeader, Classify(elf).Reason);
    }

    [Theory]
    [InlineData(2)] // "MZ" and nothing more
    [InlineData(63)] // a truncated MS-DOS header
    public void AnMsDosSignatureAloneIsNotAPeFile(int length)
    {
        Assert.Equal(
            new Classification(InputKind.NotPe, Reason: NotPeReason.NoPeHeader),
            Classify(Prefix(NativeExecutable, length)));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(126)] // the signature would run past the end of the file
    [InlineData(int.MaxValue)]
    public void AnMsDosHeaderPointingOutsideTheFileIsNotAPeFile(int peOffset)
    {
        Assert.Equal(NotPeReason.NoPeHeader, Classify(DosHeader(peOffset)).Reason);
    }

    [Fact]
    public void AnMsDosProgramWithoutAPeSignatureIsNotAPeFile()
    {
        var bytes = DosHeader(peOffset: 64);
        "NE\0\0"u8.CopyTo(bytes.AsSpan(64));

        Assert.Equal(NotPeReason.NoPeHeader, Classify(bytes).Reason);
    }

    [Fact]
    public void APeSignatureFollowedByNothingHasMalformedHeaders()
    {
        var bytes = DosHeader(peOffset: 64, length: 68);
        "PE\0\0"u8.CopyTo(bytes.AsSpan(64));

        Assert.Equal(
            new Classification(InputKind.NotPe, Reason: NotPeReason.MalformedPeHeaders),
            Classify(bytes));
    }

    [Fact]
    public void ATruncatedNativeExecutableHasMalformedHeaders()
    {
        Assert.Equal(NotPeReason.MalformedPeHeaders, Classify(Prefix(NativeExecutable, 200)).Reason);
    }

    [Fact]
    public void AMissingFileThrows()
    {
        Assert.Throws<FileNotFoundException>(
            () => PeClassifier.Classify(Path.Combine(AppContext.BaseDirectory, "no-such-file.dll")));
    }
}
