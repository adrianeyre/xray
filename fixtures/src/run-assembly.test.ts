import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isNetFramework,
  launchAssembly,
  runAssembly,
  runsOn,
} from "./run-assembly.js";

// Node stands in for `dotnet` here, running a script in place of an Assembly,
// so these need no build. The Fixture tests run real Assemblies.

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function program(source: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-program-"));
  temporary.push(folder);
  const path = join(folder, "program.mjs");
  await writeFile(path, source);
  return path;
}

const node = { dotnetPath: process.execPath };

describe("runAssembly", () => {
  it("resolves with the program's stdout, stderr and exit code", async () => {
    const path = await program(
      `process.stdout.write(process.argv.slice(2).join("|"));
       process.stderr.write("warned");
       process.exitCode = 7;`,
    );

    await expect(runAssembly(path, ["a b", "", "c"], node)).resolves.toEqual({
      stdout: "a b||c",
      stderr: "warned",
      exitCode: 7,
    });
  });

  it("gives the program no stdin", async () => {
    const path = await program(
      `let read = "";
       process.stdin.on("data", (chunk) => (read += chunk));
       process.stdin.on("end", () => process.stdout.write("end:" + read));`,
    );

    await expect(runAssembly(path, [], node)).resolves.toMatchObject({
      stdout: "end:",
    });
  });

  it("kills a program that outlives the timeout, and rejects", async () => {
    const path = await program(`setInterval(() => undefined, 1000);`);

    await expect(
      runAssembly(path, [], { ...node, timeoutMs: 200 }),
    ).rejects.toThrow(/did not exit within 200 ms/);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a .NET Framework program off Windows, where it cannot run",
    async () => {
      await expect(
        runAssembly("Program.exe", [], { targetFramework: "net48" }),
      ).rejects.toThrow(
        "Could not run Program.exe: it targets net48, and a .NET Framework program runs only on Windows.",
      );
    },
  );

  it("starts a program for any other framework with the dotnet host", async () => {
    const path = await program(`process.stdout.write("hosted");`);

    await expect(
      runAssembly(path, [], { ...node, targetFramework: "netcoreapp3.1" }),
    ).resolves.toMatchObject({ stdout: "hosted" });
  });

  it("rejects when the host cannot be started", async () => {
    await expect(
      runAssembly("Program.dll", [], {
        dotnetPath: join(tmpdir(), "no-such-dir", "dotnet"),
      }),
    ).rejects.toThrow(/^Could not run Program\.dll/);
  });
});

describe("launchAssembly", () => {
  it("resolves once a program has stayed alive for the time given, and closes it", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-program-"));
    temporary.push(folder);
    const pidFile = join(folder, "pid");
    const path = await program(
      `import { writeFileSync } from "node:fs";
       writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
       setInterval(() => undefined, 1000);`,
    );

    await expect(
      launchAssembly(path, [], { ...node, aliveForMs: 1_000 }),
    ).resolves.toEqual({ outcome: "stayed-alive", aliveForMs: 1_000 });

    // Closed: there is no such process any more.
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(
      expect.objectContaining({ code: "ESRCH" }),
    );
  });

  it("resolves with how a program that crashed before its time was up ended, and what it wrote", async () => {
    const path = await program(
      `process.stdout.write("starting\\n");
       setTimeout(() => { throw new Error("The window crashed."); }, 100);`,
    );

    const launch = await launchAssembly(path, ["a"], {
      ...node,
      aliveForMs: 10_000,
    });

    expect(launch).toMatchObject({
      outcome: "exited",
      aliveForMs: 10_000,
      exitCode: 1,
      signal: null,
      stdout: "starting\n",
      stderr: expect.stringContaining("Error: The window crashed."),
    });
    expect(launch.outcome === "exited" && launch.afterMs).toBeLessThan(10_000);
  });

  it("does not count a program that exits by itself, before its time was up, as staying alive", async () => {
    const path = await program(`process.stdout.write(process.argv[2]);`);

    await expect(
      launchAssembly(path, ["bye"], { ...node, aliveForMs: 10_000 }),
    ).resolves.toMatchObject({
      outcome: "exited",
      exitCode: 0,
      stdout: "bye",
      stderr: "",
    });
  });

  it.skipIf(process.platform === "win32")(
    "says which signal ended a program",
    async () => {
      const path = await program(
        `setTimeout(() => process.kill(process.pid, "SIGABRT"), 100);
         setInterval(() => undefined, 1000);`,
      );

      await expect(
        launchAssembly(path, [], { ...node, aliveForMs: 10_000 }),
      ).resolves.toMatchObject({
        outcome: "exited",
        exitCode: null,
        signal: "SIGABRT",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a .NET Framework program off Windows, where it cannot run",
    async () => {
      await expect(
        launchAssembly("Window.exe", [], { targetFramework: "net48" }),
      ).rejects.toThrow(
        "Could not run Window.exe: it targets net48, and a .NET Framework program runs only on Windows.",
      );
    },
  );

  it("rejects when the host cannot be started", async () => {
    await expect(
      launchAssembly("Window.dll", [], {
        dotnetPath: join(tmpdir(), "no-such-dir", "dotnet"),
      }),
    ).rejects.toThrow(/^Could not run Window\.dll with ".*dotnet"\.$/);
  });
});

describe("isNetFramework", () => {
  it.each(["net40", "net40-client", "net462", "net48", "net481"])(
    "says %s is .NET Framework",
    (moniker) => {
      expect(isNetFramework(moniker)).toBe(true);
    },
  );

  it.each(["net8.0", "net6.0-windows7.0", "netcoreapp3.1", "netstandard2.0"])(
    "says %s is not",
    (moniker) => {
      expect(isNetFramework(moniker)).toBe(false);
    },
  );
});

describe("runsOn", () => {
  it("runs a .NET Framework program only on Windows", () => {
    expect(runsOn("net48", "win32")).toBe(true);
    expect(runsOn("net48", "linux")).toBe(false);
    expect(runsOn("net48", "darwin")).toBe(false);
  });

  it("runs any other wherever the dotnet host does", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      expect(runsOn("net8.0", platform)).toBe(true);
      expect(runsOn("netcoreapp3.1", platform)).toBe(true);
    }
  });
});
