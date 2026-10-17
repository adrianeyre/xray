// The rest of a partial type in DebugSymbolSubjects.cs, for DebugSymbolsTests.

namespace Xray.Engine.Tests.Subjects;

public static partial class Halves
{
    public static int[] Mapped(int[] values) =>
        values.Select(value => value + 1).Where(value => value > 0).OrderBy(value => -value).ToArray();
}
