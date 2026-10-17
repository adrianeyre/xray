# The native Fixture

A negative Fixture (PRD §10): `hello.exe` is a **Native Executable** — a Windows
x64 console program compiled from [`hello.c`](hello.c) to machine code, with no
CLI header, IL or metadata. Xray must classify it as a Native Executable and
reject it with an explanation (FR-2, ADR 0002); nothing ever reconstructs it.

`hello.exe` is committed prebuilt, so the tests need no C compiler. It was built
with [Zig](https://ziglang.org) 0.14.1's C compiler (clang, with the MinGW-w64
headers and libraries Zig bundles), which cross-compiles to Windows from any OS:

```bash
zig cc -target x86_64-windows-gnu -Os -s hello.c -o hello.exe
```

The build is reproducible: the same command and Zig version give the same bytes
(SHA-256 `0602e8b3ceaab3f1cab68235489c496af1f5275063215027fbf806047c4f1bd7`, 17,920
bytes). Rebuild it only when `hello.c` changes, and commit both together.
