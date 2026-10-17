// Builds what @adrianeyre/xray publishes (PRD §9), beside this file:
//
//   dist/xray.js   the CLI, with @xray/core and @xray/server, in one module
//   engine/        the engine sidecar, framework-dependent: one build for every OS
//   web/           the web app `xray ui` serves
//
// and copies the licence and third-party notices from the repository's root.
// Run by `pnpm pack` and `pnpm publish`, before they pack, as `prepack`.

import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build as bundle } from "esbuild";
import { build as buildWeb } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const repository = here("../../");

const manifest = JSON.parse(await readFile(here("package.json"), "utf8")) as {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
};

await Promise.all(
  ["dist", "engine", "web"].map((folder) =>
    rm(here(folder), { recursive: true, force: true }),
  ),
);

// The engine, published with this package's version, so `xray doctor` names
// the release it came with. Built apart from the repository's own build of
// it, which the tests run.
const artifacts = await mkdtemp(join(tmpdir(), "xray-engine-"));
try {
  await promisify(execFile)("dotnet", [
    "publish",
    join(repository, "engine", "Xray.Engine", "Xray.Engine.csproj"),
    "--configuration",
    "Release",
    "--artifacts-path",
    artifacts,
    "--output",
    here("engine"),
    `-p:Version=${manifest.version}`,
  ]);
} catch (error) {
  const { stdout = "", stderr = "" } = error as {
    stdout?: string;
    stderr?: string;
  };
  throw new Error(`Publishing the engine failed.\n${stdout}${stderr}`, {
    cause: error,
  });
} finally {
  await rm(artifacts, { recursive: true, force: true });
}
// Its symbols are for debugging it here, not for running it.
for (const file of await readdir(here("engine"))) {
  if (file.endsWith(".pdb")) {
    await rm(here(`engine/${file}`));
  }
}

await buildWeb({
  root: dirname(
    createRequire(import.meta.url).resolve("@xray/web/package.json"),
  ),
  logLevel: "warn",
  build: { outDir: here("web"), emptyOutDir: true },
});

// Everything but this package's own dependencies, which are installed with it.
await bundle({
  entryPoints: [here("src/xray.ts")],
  outfile: here("dist/xray.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  external: Object.keys(manifest.dependencies),
  logLevel: "warning",
});

await Promise.all(
  ["LICENSE", "THIRD-PARTY-NOTICES.md"].map((file) =>
    copyFile(join(repository, file), here(file)),
  ),
);
