// File-scoped types for AssemblyDecompilerTests to find, visible only in this file.

namespace Xray.Engine.Tests.Subjects;

/// <summary>A file-scoped type an ordinary one uses.</summary>
file static class Helper
{
    public static int Twice(int value) => value * 2;
}

/// <summary>A file-scoped type nothing uses, declared with the rest of its file.</summary>
file interface IUnused
{
}

/// <summary>An ordinary type, which can see its file's file-scoped types.</summary>
public static class FileScoped
{
    public static int Doubled(int value) => Helper.Twice(value);

    public static Type HelperType => typeof(Helper);
}
