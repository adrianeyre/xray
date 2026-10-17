import { describe, expect, it } from "vitest";

import {
  POSIX_LAUNCHER,
  TARGETS,
  WINDOWS_LAUNCHER,
  archiveName,
  bundleName,
  bundleReadme,
  nodeArchive,
  shaFor,
  type Target,
} from "./bundles.js";

// The downloads each GitHub release carries, as bundle.ts names and lays them
// out. That each one runs is checked by the CI workflow, on each OS, once
// they are attached to the release.

/** The target named `name`. */
function target(name: string): Target {
  const found = TARGETS.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(`No target ${name}.`);
  }
  return found;
}

describe("the release's downloads", () => {
  it("are for Windows, macOS and Linux, on x64 and Arm each", () => {
    expect(TARGETS.map((target) => target.name)).toEqual([
      "win-x64",
      "win-arm64",
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "linux-arm64",
    ]);
  });

  it("are named for the platform alone, so the latest's address never changes, zipped for Windows and gzipped tarballs elsewhere", () => {
    expect(TARGETS.map((target) => archiveName(target))).toEqual([
      "xray-win-x64.zip",
      "xray-win-arm64.zip",
      "xray-darwin-arm64.tar.gz",
      "xray-darwin-x64.tar.gz",
      "xray-linux-x64.tar.gz",
      "xray-linux-arm64.tar.gz",
    ]);
  });

  it("unpack to a folder naming the version and the platform", () => {
    expect(bundleName("1.2.0", target("linux-x64"))).toBe(
      "xray-1.2.0-linux-x64",
    );
  });

  it("take Node.js from nodejs.org, for each platform", () => {
    expect(nodeArchive("26.10.0", target("win-x64"))).toEqual({
      file: "node-v26.10.0-win-x64.zip",
      url: "https://nodejs.org/dist/v26.10.0/node-v26.10.0-win-x64.zip",
      binary: "node-v26.10.0-win-x64/node.exe",
    });
    expect(nodeArchive("26.10.0", target("darwin-arm64"))).toEqual({
      file: "node-v26.10.0-darwin-arm64.tar.gz",
      url: "https://nodejs.org/dist/v26.10.0/node-v26.10.0-darwin-arm64.tar.gz",
      binary: "node-v26.10.0-darwin-arm64/bin/node",
    });
  });

  it("check each Node.js against the SHA-256 nodejs.org gives for it, and refuse one it gives none for", () => {
    const sha = "a".repeat(64);
    const shasums = `${"b".repeat(64)}  node-v26.10.0-linux-x64.tar.xz\n${sha}  node-v26.10.0-linux-x64.tar.gz\n`;
    expect(shaFor(shasums, "node-v26.10.0-linux-x64.tar.gz")).toBe(sha);
    expect(() => shaFor(shasums, "node-v26.10.0-win-x64.zip")).toThrow(
      "SHASUMS256.txt gives no SHA-256 for node-v26.10.0-win-x64.zip.",
    );
  });

  it("run the package's binary with the Node.js beside it, however they are reached", () => {
    expect(POSIX_LAUNCHER.startsWith("#!/bin/sh\n")).toBe(true);
    expect(POSIX_LAUNCHER).toContain(
      'exec "$here/runtime/node" "$here/app/bin/xray.js" "$@"',
    );
    // Linked into a folder on PATH, it still finds what is beside it.
    expect(POSIX_LAUNCHER).toContain('readlink "$self"');
    expect(WINDOWS_LAUNCHER).toContain(
      '"%~dp0runtime\\node.exe" "%~dp0app\\bin\\xray.js" %*',
    );
    expect(
      WINDOWS_LAUNCHER.split("\n").every(
        (line) => line === "" || line.endsWith("\r"),
      ),
    ).toBe(true);
  });

  it("say what they need, and how to run them, on each OS", () => {
    const forWindows = bundleReadme("1.2.0", target("win-x64"), "26.10.0");
    const forMac = bundleReadme("1.2.0", target("darwin-arm64"), "26.10.0");

    expect(forWindows).toContain("Xray 1.2.0 for Windows (x64)");
    expect(forWindows).toContain("xray.cmd doctor");
    expect(forWindows).toContain("\r\n");
    expect(forMac).toContain("Xray 1.2.0 for macOS (Apple silicon)");
    expect(forMac).toContain("./xray doctor");
    expect(forMac).not.toContain("\r");
    for (const readme of [forWindows, forMac]) {
      expect(readme).toContain(".NET SDK 8 or later");
      expect(readme).toContain("26.10.0 it runs on");
      expect(readme).toContain("https://xray.adrianeyre.co.uk/");
    }
  });
});
