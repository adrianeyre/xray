import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  browserCommand,
  listenForStop,
  openBrowser,
  STOP_SIGNALS,
} from "./ui.js";

const URL = "http://127.0.0.1:9729/";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("browserCommand", () => {
  it.each([
    ["darwin", "open", [URL]],
    ["win32", "cmd", ["/c", "start", '""', `"${URL}"`]],
    ["linux", "xdg-open", [URL]],
    ["freebsd", "xdg-open", [URL]],
  ] as const)("on %s, is %s", (platform, command, args) => {
    expect(browserCommand(URL, platform)).toEqual([command, args]);
  });
});

describe("openBrowser", () => {
  it("opens none when BROWSER is none", async () => {
    expect(await openBrowser(URL, { BROWSER: "none" }, "linux")).toBe(
      "skipped",
    );
  });

  it("fails when this OS's command for opening one cannot be found", async () => {
    const empty = await mkdtemp(join(tmpdir(), "xray-ui-test-"));
    temporary.push(empty);

    expect(await openBrowser(URL, { PATH: empty }, "linux")).toBe("failed");
  });

  // A stand-in for xdg-open: a shell script, so not on Windows.
  it.skipIf(process.platform === "win32")(
    "runs this OS's command for opening one, with the address",
    async () => {
      const bin = await mkdtemp(join(tmpdir(), "xray-ui-test-"));
      temporary.push(bin);
      const opened = join(bin, "opened");
      const xdgOpen = join(bin, "xdg-open");
      await writeFile(xdgOpen, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n`);
      await chmod(xdgOpen, 0o755);

      expect(
        await openBrowser(URL, { PATH: `${bin}:/usr/bin:/bin` }, "linux"),
      ).toBe("opened");
      await expect
        .poll(() => readFile(opened, "utf8").catch(() => ""))
        .toBe(URL);
    },
  );
});

describe("listenForStop", () => {
  it.each(STOP_SIGNALS)("resolves on %s", async (signal) => {
    const stop = listenForStop();
    try {
      process.emit(signal, signal);

      expect(await stop.stopped).toBe(signal);
    } finally {
      stop.dispose();
    }
  });

  it("gives the signals back when disposed", () => {
    const before = STOP_SIGNALS.map((signal) => process.listenerCount(signal));

    listenForStop().dispose();

    expect(STOP_SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(
      before,
    );
  });
});
