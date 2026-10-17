import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

// Runs `xray ui` itself, as a user would, serving the real web app built by
// the global setup, with BROWSER=none so no browser opens.

const XRAY = fileURLToPath(new URL("../bin/xray.js", import.meta.url));

const children: ChildProcess[] = [];
const blockers: Server[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }
  await Promise.all(
    blockers
      .splice(0)
      .map((blocker) => new Promise((resolve) => blocker.close(resolve))),
  );
});

interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface XrayUi {
  readonly child: ChildProcess;
  /** Resolves once it says where it is running, and its Workspace. */
  readonly running: Promise<{ url: string; workspace: string }>;
  readonly exited: Promise<Exit>;
}

function xrayUi(args: string[]): XrayUi {
  const child = spawn(process.execPath, [XRAY, "ui", ...args], {
    env: { ...process.env, BROWSER: "none" },
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (text: string) => {
    stderr += text;
  });
  const running = new Promise<{ url: string; workspace: string }>(
    (resolve, reject) => {
      child.stdout.setEncoding("utf8").on("data", (text: string) => {
        stdout += text;
        const url = /^Xray is running at (\S+)$/m.exec(stdout)?.[1];
        const workspace = /Workspace: (.+)$/m.exec(stdout)?.[1];
        if (url !== undefined && workspace !== undefined) {
          resolve({ url, workspace });
        }
      });
      child.once("exit", () =>
        reject(new Error(`xray ui exited before it ran.\n${stdout}${stderr}`)),
      );
    },
  );
  // Not every test waits for it to run; one that does still sees it fail.
  running.catch(() => undefined);
  const exited = new Promise<Exit>((resolve) =>
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    ),
  );
  return { child, running, exited };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Has something else listen on a port of 127.0.0.1, and says which. */
function occupyPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const blocker = createServer();
    blockers.push(blocker);
    blocker.once("error", reject);
    blocker.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = blocker.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Not listening on a TCP port."));
      } else {
        resolve(address.port);
      }
    });
  });
}

describe("xray ui", () => {
  it("serves the web app's shell page on 127.0.0.1", async () => {
    const ui = xrayUi(["--port", "0"]);
    const { url } = await ui.running;

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');
  });

  // Node cannot send a child process SIGINT or SIGTERM on Windows, where it
  // would end the process outright, as Task Manager does.
  it.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM"] as const)(
    "on %s, stops, deletes its Workspace with everything in it, and exits 0",
    async (signal) => {
      const ui = xrayUi(["--port", "0"]);
      const { url, workspace } = await ui.running;
      expect((await stat(workspace)).isDirectory()).toBe(true);
      // As an upload would leave it.
      await mkdir(join(workspace, "upload"));
      await writeFile(join(workspace, "upload", "MyApp.dll"), "MZ");

      ui.child.kill(signal);
      const exit = await ui.exited;

      expect(exit).toMatchObject({ code: 0, signal: null, stderr: "" });
      expect(exit.stdout).toContain(
        "Xray has stopped, and its Workspace is deleted.\n",
      );
      expect(await exists(workspace)).toBe(false);
      await expect(fetch(url)).rejects.toThrow();
    },
  );

  it("reports a busy port with a free one to try instead, and exits 1", async () => {
    const busy = await occupyPort();

    const exit = await xrayUi(["--port", String(busy)]).exited;

    expect(exit.code).toBe(1);
    expect(exit.stdout).toBe("");
    const suggestion = new RegExp(
      `^Port ${busy} on 127\\.0\\.0\\.1 is already in use\\. Try another, such as: xray ui --port (\\d+)\\n$`,
    ).exec(exit.stderr);
    expect(suggestion, exit.stderr).not.toBeNull();
    // The port it suggests is one it can start on.
    const ui = xrayUi(["--port", suggestion?.[1] as string]);
    expect((await ui.running).url).toBe(`http://127.0.0.1:${suggestion?.[1]}/`);
  });
});
