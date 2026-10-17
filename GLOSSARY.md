# Xray

Xray turns compiled .NET assemblies back into buildable, runnable C# solutions.

## Inputs

**Assembly**:
A compiled .NET `.exe` or `.dll` containing IL and metadata.
_Avoid_: Binary, executable (when the file is known to be managed)

**Managed Assembly**:
An Assembly whose code is .NET IL; the only kind Xray reconstructs.
_Avoid_: .NET exe, C# exe

**Native Executable**:
A PE file containing machine code rather than IL; detected and rejected.
_Avoid_: Unmanaged assembly, C++ exe

**Sibling Assembly**:
An application-owned Assembly found alongside the input Assembly that is neither framework nor a NuGet package.
_Avoid_: Local DLL, companion assembly

## Process

**Reconstruction**:
The whole journey from an input Assembly to a Recovered Solution.
_Avoid_: Recovery, decompiling (for the whole process), rebuild

**Decompilation**:
Turning the IL of a single type or member into C# source.
_Avoid_: Disassembly (which yields IL or machine instructions, not C#)

**Dependency Resolution**:
Deciding, for each referenced assembly, whether it is satisfied by the framework, a NuGet package, a Sibling Assembly, a copied binary, or nothing.

**Unresolved Dependency**:
A referenced assembly that Dependency Resolution could not satisfy.
_Avoid_: Missing reference

## Outputs

**Recovered Solution**:
The `.sln`, projects, source and resources produced by a Reconstruction.
_Avoid_: Output, decompiled project

**Full Reconstruction**:
A Reconstruction whose Recovered Solution builds and behaves like the original.

**Partial Reconstruction**:
A Reconstruction that produced a Recovered Solution but failed to build or to match behaviour, reported with its specific failures.

## Verification

**Round-trip**:
Source → compile → Reconstruction → rebuild → compare behaviour; the proof that Xray works.

**Fixture**:
A C# project in the repo used as the source of a Round-trip.
_Avoid_: Sample, test app
