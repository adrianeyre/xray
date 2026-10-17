# Reconstruct Managed Assemblies only; reject Native Executables

Xray's promise is a Recovered Solution that builds and behaves like the original. That is achievable for Managed Assemblies, whose IL and metadata preserve types, members and signatures, but not for Native Executables, where compilation discards that information and the best possible output is pseudocode. Native Executables are therefore detected and rejected with an explanation rather than half-supported.

## Consequences

A native disassembly/pseudocode mode remains a possible future phase, but it will never be presented as Reconstruction. Obfuscated Managed Assemblies are processed and flagged, never deobfuscated.
