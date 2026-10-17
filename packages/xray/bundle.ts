// `pnpm --filter @adrianeyre/xray bundle <tarball> <out-dir>`: writes the
// downloads a GitHub release carries (src/bundles.ts) to <out-dir> from
// <tarball>, the package `pnpm pack` made: for each OS and architecture, the
// package with its dependencies installed, the Node.js this runs on for that
// platform, checked against nodejs.org's SHA-256, and launchers; then a
// SHA256SUMS.txt of them all. The download for this machine is run, to check
// it starts, before it is archived. The CI workflow runs it once it has
// packed a version; it needs tar, and zip.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

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
} from "./src/bundles.js";

const run = promisify(execFile);

const [tarballArgument, outArgument] = process.argv.slice(2);
if (tarballArgument === undefined || outArgument === undefined) {
  throw new Error("Usage: bundle.ts <tarball> <out-dir>");
}
const tarball = resolve(tarballArgument);
const out = resolve(outArgument);
const nodeVersion = process.versions.node;

const work = await mkdtemp(join(tmpdir(), "xray-bundles-"));
try {
  // The package, as npm installs it: its files, then its dependencies.
  await run("tar", ["-xzf", tarball, "-C", work]);
  const app = join(work, "package");
  const manifest = join(app, "package.json");
  const installed = JSON.parse(await readFile(manifest, "utf8")) as {
    version: string;
    devDependencies?: unknown;
  };
  const { version } = installed;
  // Without its devDependencies, as npm installs it for a user: with them,
  // npm resolves them all even with --omit=dev, and the workspace's own
  // (@xray/cli…) are on no registry.
  delete installed.devDependencies;
  await writeFile(manifest, `${JSON.stringify(installed, null, 2)}\n`);
  await run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
    ],
    { cwd: app },
  );

  const shasums = await download(
    `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`,
  ).then((bytes) => bytes.toString("utf8"));

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const archives: string[] = [];
  for (const target of TARGETS) {
    archives.push(await bundle(target, version, app, shasums));
  }

  const sums = await Promise.all(
    archives.map(
      async (archive) =>
        `${createHash("sha256")
          .update(await readFile(archive))
          .digest("hex")}  ${basename(archive)}`,
    ),
  );
  await writeFile(join(out, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
  process.stdout.write(
    `Wrote ${archives.length} downloads of Xray ${version}, on Node.js ${nodeVersion}, and SHA256SUMS.txt to ${out}\n`,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

/** Writes the download for `target` to `out`, and resolves its path. */
async function bundle(
  target: Target,
  version: string,
  app: string,
  shasums: string,
): Promise<string> {
  const name = bundleName(version, target);
  const folder = join(work, "bundles", name);
  await mkdir(join(folder, "runtime"), { recursive: true });
  await cp(app, join(folder, "app"), { recursive: true });

  // Node.js for the platform, checked against the SHA-256 nodejs.org gives.
  const node = nodeArchive(nodeVersion, target);
  const archive = await download(node.url);
  const sha = createHash("sha256").update(archive).digest("hex");
  if (sha !== shaFor(shasums, node.file)) {
    throw new Error(`${node.url} is not what nodejs.org's SHA-256 says.`);
  }
  const unpacked = join(work, "node", target.name);
  await mkdir(unpacked, { recursive: true });
  const archivePath = join(unpacked, node.file);
  await writeFile(archivePath, archive);
  const folderInArchive = node.binary.split("/")[0] as string;
  const license = `${folderInArchive}/LICENSE`;
  if (target.os === "windows") {
    await run("unzip", [
      "-q",
      archivePath,
      node.binary,
      license,
      "-d",
      unpacked,
    ]);
  } else {
    await run("tar", [
      "-xzf",
      archivePath,
      "-C",
      unpacked,
      node.binary,
      license,
    ]);
  }
  const binary = join(folder, "runtime", basename(node.binary));
  await cp(join(unpacked, node.binary), binary);
  await cp(join(unpacked, license), join(folder, "runtime", "LICENSE"));

  if (target.os === "windows") {
    await writeFile(join(folder, "xray.cmd"), WINDOWS_LAUNCHER);
  } else {
    await chmod(binary, 0o755);
    await writeFile(join(folder, "xray"), POSIX_LAUNCHER, { mode: 0o755 });
  }
  await writeFile(
    join(folder, "README.txt"),
    bundleReadme(version, target, nodeVersion),
  );

  // The download for this machine, run as a user would, before it is archived.
  if (
    target.name ===
    `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`
  ) {
    const { stdout } =
      target.os === "windows"
        ? await run("cmd", ["/c", join(folder, "xray.cmd"), "--help"])
        : await run(join(folder, "xray"), ["--help"]);
    if (!stdout.includes("Usage: xray <command>")) {
      throw new Error(`${name}'s xray --help printed no usage:\n${stdout}`);
    }
  }

  const file = join(out, archiveName(target));
  const parent = join(work, "bundles");
  if (target.os === "windows") {
    await run("zip", ["-qr", "-X", file, name], { cwd: parent });
  } else {
    await run("tar", ["-czf", file, "-C", parent, name]);
  }
  // Each download's own copy is no longer needed once archived.
  await rm(folder, { recursive: true, force: true });
  await rm(unpacked, { recursive: true, force: true });
  return file;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Downloading ${url} failed: ${response.status} ${response.statusText}.`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
