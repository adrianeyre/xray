/*
 * The source of hello.exe: a Native Executable that Xray must detect and reject
 * (ADR 0002). Compiled to x64 machine code, it has no CLI header, IL or metadata.
 * See README.md for how hello.exe was built from it.
 */
#include <stdio.h>

int main(void)
{
    puts("Hello from a Native Executable.");
    return 0;
}
