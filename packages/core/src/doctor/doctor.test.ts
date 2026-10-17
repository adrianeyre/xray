import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENGINE_PROTOCOL_VERSION } from "../engine/protocol.js";
import {
  MINIMUM_NODE_MAJOR,
  runDoctor,
  type DoctorCheck,
  type DoctorOptions,
} from "./doctor.js";
import type { DotnetSdk } from "./dotnet-sdks.js";

// The SDK lookup is faked, and the engine is a Node script run in place of
// `dotnet Xray.Engine.dll` (see ../engine/fakes).
function fakeEngine(name: string): string {
  return fileURLToPath(new URL(`../engine/fakes/${name}.mjs`, import.meta.url));
}

function sdks(...versions: string[]): DotnetSdk[] {
  return versions.map((version) => ({
    version,
    path: "/usr/share/dotnet/sdk",
  }));
}

const healthy: DoctorOptions = {
  nodeVersion: "26.10.0",
  listSdks: () => Promise.resolve(sdks("8.0.425")),
  dotnetPath: process.execPath,
  enginePath: fakeEngine("healthy"),
};

async function check(
  id: DoctorCheck["id"],
  options: DoctorOptions,
): Promise<DoctorCheck | undefined> {
  const report = await runDoctor({ ...healthy, ...options });
  return report.checks.find((c) => c.id === id);
}

const INSTALL_SDK = "Install the .NET SDK 8 or later from https://dot.net.";

describe("runDoctor", () => {
  it("passes every check on a correctly set-up machine", async () => {
    expect(await runDoctor(healthy)).toEqual({
      passed: true,
      checks: [
        {
          id: "node",
          title: "Node.js",
          passed: true,
          summary: "26.10.0",
        },
        {
          id: "dotnet-sdk",
          title: ".NET SDK",
          passed: true,
          summary: "8.0.425 (/usr/share/dotnet/sdk)",
        },
        {
          id: "engine",
          title: "Xray engine",
          passed: true,
          summary: `0.0.0-fake (protocol ${ENGINE_PROTOCOL_VERSION}, ICSharpCode.Decompiler 0.0.0)`,
        },
      ],
    });
  });

  it("requires the Node.js versions package.json does", async () => {
    const rootPackage = JSON.parse(
      await readFile(new URL("../../../../package.json", import.meta.url), {
        encoding: "utf8",
      }),
    ) as { engines: { node: string } };

    expect(`>=${MINIMUM_NODE_MAJOR}`).toBe(rootPackage.engines.node);
  });

  it("passes on a later Node.js version", async () => {
    expect(await check("node", { nodeVersion: "27.1.0" })).toEqual({
      id: "node",
      title: "Node.js",
      passed: true,
      summary: "27.1.0",
    });
  });

  it("fails, and says how to fix it, on an older Node.js version", async () => {
    const report = await runDoctor({ ...healthy, nodeVersion: "24.4.0" });

    expect(report.passed).toBe(false);
    expect(report.checks[0]).toEqual({
      id: "node",
      title: "Node.js",
      passed: false,
      summary: "Node.js 24.4.0 is running; Xray requires Node.js 26 or later.",
      fix: "Install Node.js 26 or later from https://nodejs.org (a version manager such as fnm, nvm or Volta can keep it alongside other versions) and run Xray with it.",
    });
  });

  it("asks the SDK lookup about the configured dotnet", async () => {
    const asked: string[] = [];
    await runDoctor({
      ...healthy,
      dotnetPath: "/opt/dotnet/dotnet",
      enginePath: join(tmpdir(), "no-such-engine.dll"),
      listSdks: (dotnetPath) => {
        asked.push(dotnetPath);
        return Promise.resolve(sdks("8.0.425"));
      },
    });

    expect(asked).toEqual(["/opt/dotnet/dotnet"]);
  });

  it("reports a missing dotnet with install guidance", async () => {
    const report = await runDoctor({
      ...healthy,
      listSdks: () => Promise.resolve(undefined),
    });

    expect(report.passed).toBe(false);
    expect(report.checks[1]).toMatchObject({
      id: "dotnet-sdk",
      passed: false,
      summary: `"${process.execPath}" was not found, so no .NET SDK is available.`,
      fix: "Install the .NET SDK 8 or later from https://dot.net and make sure `dotnet` is on PATH.",
    });
  });

  it("reports dotnet without any SDK with install guidance", async () => {
    expect(
      await check("dotnet-sdk", { listSdks: () => Promise.resolve([]) }),
    ).toMatchObject({
      passed: false,
      summary: expect.stringContaining(
        "is installed but no .NET SDK is",
      ) as unknown,
      fix: INSTALL_SDK,
    });
  });

  it("reports a too-old SDK with install guidance", async () => {
    const report = await runDoctor({
      ...healthy,
      listSdks: () => Promise.resolve(sdks("7.0.410")),
    });

    expect(report.passed).toBe(false);
    expect(report.checks[1]).toEqual({
      id: "dotnet-sdk",
      title: ".NET SDK",
      passed: false,
      summary: "Only .NET SDK 7.0.410 is installed; Xray needs 8 or later.",
      fix: INSTALL_SDK,
    });
  });

  it("lists every too-old SDK, newest first", async () => {
    expect(
      await check("dotnet-sdk", {
        listSdks: () => Promise.resolve(sdks("3.1.426", "7.0.410", "6.0.428")),
      }),
    ).toMatchObject({
      passed: false,
      summary:
        "Only .NET SDK 7.0.410, 6.0.428, 3.1.426 are installed; Xray needs 8 or later.",
      fix: INSTALL_SDK,
    });
  });

  it("passes with the newest supported SDK when old ones are installed too", async () => {
    expect(
      await check("dotnet-sdk", {
        listSdks: () =>
          Promise.resolve(sdks("6.0.428", "10.0.100", "8.0.425", "9.0.306")),
      }),
    ).toMatchObject({
      passed: true,
      summary: "10.0.100 (/usr/share/dotnet/sdk)",
    });
  });

  it("reports an SDK lookup that fails", async () => {
    expect(
      await check("dotnet-sdk", {
        dotnetPath: "dotnet",
        listSdks: () => Promise.reject(new Error("Command failed: exit 134")),
      }),
    ).toMatchObject({
      passed: false,
      summary:
        'Could not list the installed .NET SDKs with "dotnet --list-sdks": Command failed: exit 134',
      fix: "Check that `dotnet --list-sdks` runs, or reinstall the .NET SDK 8 or later from https://dot.net.",
    });
  });

  it("reports a missing engine build, whose message says how to fix it", async () => {
    const enginePath = join(tmpdir(), "no-such-engine.dll");
    const report = await runDoctor({ ...healthy, enginePath });

    expect(report.passed).toBe(false);
    expect(report.checks[2]).toEqual({
      id: "engine",
      title: "Xray engine",
      passed: false,
      summary: `The Xray engine was not found at ${enginePath}. Build it with \`pnpm build:engine\`.`,
    });
  });

  it("reports an engine on another protocol version", async () => {
    expect(
      await check("engine", {
        enginePath: fakeEngine("speaks-another-protocol"),
      }),
    ).toEqual({
      id: "engine",
      title: "Xray engine",
      passed: false,
      summary: `The Xray engine speaks protocol version 99 but Xray expects version ${ENGINE_PROTOCOL_VERSION}. Xray and its engine come from different builds; rebuild the engine with \`pnpm build:engine\`.`,
    });
  });

  it("reports an engine that crashes, with its stderr and how to fix it", async () => {
    expect(
      await check("engine", { enginePath: fakeEngine("crashes-on-ping") }),
    ).toEqual({
      id: "engine",
      title: "Xray engine",
      passed: false,
      summary:
        "The Xray engine exited unexpectedly (exit code 134).\n\nUnhandled exception. System.InvalidOperationException: boom",
      fix: "Rebuild the engine with `pnpm build:engine` and try again.",
    });
  });

  it("reports an engine that never answers, rather than hanging", async () => {
    expect(
      await check("engine", {
        enginePath: fakeEngine("hangs-after-handshake"),
        timeoutMs: 300,
      }),
    ).toMatchObject({
      passed: false,
      summary: 'The Xray engine did not answer "ping" within 300 ms.',
      fix: "Rebuild the engine with `pnpm build:engine` and try again.",
    });
  });

  it("runs every check even when the first ones fail", async () => {
    const report = await runDoctor({
      nodeVersion: "20.0.0",
      listSdks: () => Promise.resolve(undefined),
      dotnetPath: join(tmpdir(), "no-such-dir", "dotnet"),
    });

    expect(report.passed).toBe(false);
    expect(report.checks.map(({ id, passed }) => ({ id, passed }))).toEqual([
      { id: "node", passed: false },
      { id: "dotnet-sdk", passed: false },
      { id: "engine", passed: false },
    ]);
    expect(report.checks[2]?.summary).toContain(
      "Install the .NET SDK 8 or later",
    );
  });
});
