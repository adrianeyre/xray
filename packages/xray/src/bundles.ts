// The downloads each GitHub release carries: @adrianeyre/xray, as published
// to npm, with its dependencies and a Node.js of its own, for each OS and
// architecture, so it runs without Node.js or pnpm installed. It still needs
// the .NET SDK, which builds what it recovers. bundle.ts writes them.

export interface Target {
  /** Its name in the download's: Node.js's name for the platform. */
  readonly name: string;
  readonly os: "windows" | "macos" | "linux";
  /** What people call it, on the release's page. */
  readonly label: string;
}

/** Every OS and architecture a release has a download for. */
export const TARGETS: readonly Target[] = [
  { name: "win-x64", os: "windows", label: "Windows (x64)" },
  { name: "win-arm64", os: "windows", label: "Windows (Arm)" },
  { name: "darwin-arm64", os: "macos", label: "macOS (Apple silicon)" },
  { name: "darwin-x64", os: "macos", label: "macOS (Intel)" },
  { name: "linux-x64", os: "linux", label: "Linux (x64)" },
  { name: "linux-arm64", os: "linux", label: "Linux (Arm64)" },
];

/** The folder the download unpacks to, naming its version: `xray-1.2.0-linux-x64`. */
export function bundleName(version: string, target: Target): string {
  return `xray-${version}-${target.name}`;
}

/**
 * The download's file, the same from release to release, so that
 * `releases/latest/download/<file>` always gets the latest: `xray-linux-x64.tar.gz`.
 */
export function archiveName(target: Target): string {
  return `xray-${target.name}${archiveExtension(target)}`;
}

/** A zip on Windows, which opens it without anything installed; a gzipped tarball, keeping `xray` executable, elsewhere. */
export function archiveExtension(target: Target): ".zip" | ".tar.gz" {
  return target.os === "windows" ? ".zip" : ".tar.gz";
}

/** Node.js's own archive for `target`, on nodejs.org, and where its binary is inside it. */
export function nodeArchive(
  nodeVersion: string,
  target: Target,
): { readonly file: string; readonly url: string; readonly binary: string } {
  const folder = `node-v${nodeVersion}-${target.name}`;
  const file = `${folder}${archiveExtension(target)}`;
  return {
    file,
    url: `https://nodejs.org/dist/v${nodeVersion}/${file}`,
    binary:
      target.os === "windows" ? `${folder}/node.exe` : `${folder}/bin/node`,
  };
}

/** The SHA-256 nodejs.org gives for `file`, from its SHASUMS256.txt. */
export function shaFor(shasums: string, file: string): string {
  const line = shasums
    .split("\n")
    .find((each) => each.trim().endsWith(`  ${file}`));
  const sha = line?.trim().split(/\s+/)[0];
  if (sha === undefined || !/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`SHASUMS256.txt gives no SHA-256 for ${file}.`);
  }
  return sha;
}

/** `xray` on macOS and Linux: runs the package's binary with the Node.js beside it, from wherever it is linked. */
export const POSIX_LAUNCHER = `#!/bin/sh
# Runs Xray with the Node.js it ships with. Put this folder on your PATH, or
# link this file into a folder that is, and run \`xray\`.
set -e
self="$0"
while [ -L "$self" ]; do
  link="$(readlink "$self")"
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname "$self")/$link" ;;
  esac
done
here="$(cd "$(dirname "$self")" && pwd)"
exec "$here/runtime/node" "$here/app/bin/xray.js" "$@"
`;

/** `xray.cmd` on Windows: the same, for Command Prompt and PowerShell. */
export const WINDOWS_LAUNCHER = `@echo off\r
rem Runs Xray with the Node.js it ships with. Put this folder on your PATH, and run xray.\r
"%~dp0runtime\\node.exe" "%~dp0app\\bin\\xray.js" %*\r
`;

/** What the download says about itself, in its README.txt. */
export function bundleReadme(
  version: string,
  target: Target,
  nodeVersion: string,
): string {
  const windows = target.os === "windows";
  const newline = windows ? "\r\n" : "\n";
  const run = windows ? "xray.cmd" : "./xray";
  return [
    `Xray ${version} for ${target.label}`,
    "",
    "Xray turns compiled .NET applications back into buildable, runnable C#",
    "solutions. This download runs on its own: it holds Xray and the Node.js",
    `${nodeVersion} it runs on, so neither Node.js nor pnpm need be installed.`,
    "",
    "You need",
    "  The .NET SDK 8 or later, which builds what Xray recovers:",
    "  https://dotnet.microsoft.com/download",
    "",
    "Run it",
    `  ${run} doctor        checks the .NET SDK and Xray's engine`,
    `  ${run} ui            opens the web UI in your browser`,
    `  ${run} --help        every command and option`,
    "",
    windows
      ? "  Add this folder to your PATH to run it as `xray` from anywhere."
      : "  Add this folder to your PATH, or link `xray` into a folder that is,\n  to run it as `xray` from anywhere.",
    "",
    "Xray is intended for Assemblies you own or have the right to analyse.",
    "",
    "More: https://xray.adrianeyre.co.uk/",
    "Licences: app/LICENSE and app/THIRD-PARTY-NOTICES.md for Xray,",
    "runtime/LICENSE for Node.js.",
    "",
  ].join(newline);
}
