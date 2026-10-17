# Always emit SDK-style projects, even for .NET Framework

Recovered Solutions always use SDK-style `.csproj` files, including for .NET Framework 4.x targets, which reference `Microsoft.NETFramework.ReferenceAssemblies`. Legacy-format projects would mirror the original more faithfully but only build with Visual Studio/MSBuild on Windows, breaking build verification on macOS and Linux and in cross-platform CI.

## Consequences

The original target framework is preserved, but project files will not match what the original author's IDE generated. Recovered .NET Framework WinForms/WPF apps build anywhere but run only on Windows.
