// `pnpm --filter @xray/site capture`: writes the site's pictures of `xray ui`
// (screenshots.ts) to static/images/, from the UI itself, in headless
// Chromium, reconstructing Fixtures: the wpf Fixture's Tally, a Full
// Reconstruction, and the missing-reference Fixture, a Partial one. Run it
// again when the UI changes, after `pnpm build:engine` and `pnpm build:web`,
// with Chromium installed for Playwright:
//
//   pnpm --filter @xray/site exec playwright-core install chromium-headless-shell

import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

import { coreCommands } from "@xray/cli";
import { buildFixture } from "@xray/fixtures";
import { chromium, type Browser, type Page } from "playwright-core";

import { encodeGif, type Frame } from "./gif.js";
import { SCREENSHOTS, TOUR } from "./screenshots.js";
import { STATIC_DIRECTORY } from "./site.js";

const IMAGES = join(STATIC_DIRECTORY, "images");
const VIEWPORT = { width: 1200, height: 760 };
/** The longest a Reconstruction is waited for. */
const RECONSTRUCTION_TIMEOUT_MS = 5 * 60_000;

const [tour, reconstruction, recoveredSolution, partial] = [
  TOUR,
  ...SCREENSHOTS,
].map((screenshot) => join(IMAGES, screenshot.file)) as [
  string,
  string,
  string,
  string,
];

// Each Assembly is copied, with what was built beside it, to a folder of its
// name, as an app would be installed, so the pictures show a path like one.
const apps = await mkdtemp(join(tmpdir(), "apps-"));
const server = await coreCommands().ui(0);
let browser: Browser | undefined;
try {
  const tally = await copyFixture("wpf");
  const missingReference = await copyFixture("missing-reference");
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      "Chromium could not be started. Install it for Playwright with `pnpm --filter @xray/site exec playwright-core install --with-deps chromium-headless-shell`.",
      { cause: error },
    );
  }

  // The tour, in the viewport, as someone using it would see it.
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(server.url);
  const frames: Frame[] = [];
  const frame = async (delay: number) => {
    frames.push({ png: await page.screenshot(), delay });
  };
  await frame(1200);
  await page.locator("#assembly-path").fill(tally);
  await frame(1500);
  await page.getByRole("button", { name: "Reconstruct", exact: true }).click();
  // The path given, then each stage below it as it runs, a frame for as long
  // as it was shown.
  await page.locator("section.reconstruction").waitFor();
  await scrollToTop(page, 'label[for="assembly-path"]');
  const outcome = page.locator(".report .outcome");
  const started = Date.now();
  let shown = Date.now();
  let png = await page.screenshot();
  while (!(await outcome.isVisible())) {
    if (Date.now() - started > RECONSTRUCTION_TIMEOUT_MS) {
      throw new Error(`Reconstructing ${tally} took too long.`);
    }
    await page.waitForTimeout(250);
    frames.push({ png, delay: Date.now() - shown });
    shown = Date.now();
    png = await page.screenshot();
  }
  frames.push({ png, delay: Date.now() - shown });
  await scrollToTop(page, "section.reconstruction");
  await frame(3500);
  await scrollToTop(page, "section.explorer");
  await frame(1200);
  await openFile(page, "MainWindow.xaml");
  await frame(3500);
  await openFile(page, "MainWindow.xaml.cs");
  await frame(3500);
  await writeFile(tour, encodeGif(frames));

  // The screenshots, sharper, each of the part of the page it is of.
  const sharp = await browser.newPage({
    viewport: { width: VIEWPORT.width, height: 1400 },
    deviceScaleFactor: 2,
  });
  await reconstruct(sharp, server.url, tally);
  await scrollToTop(sharp, "section.reconstruction");
  await sharp.screenshot({
    path: reconstruction,
    clip: await around(sharp, "section.reconstruction", ".report .outcome"),
  });
  await scrollToTop(sharp, "section.explorer");
  await openFile(sharp, "MainWindow.xaml");
  await sharp.screenshot({
    path: recoveredSolution,
    clip: await around(sharp, "section.explorer", "section.explorer"),
  });

  await reconstruct(sharp, server.url, missingReference);
  await scrollToTop(sharp, "section.report");
  await sharp.screenshot({
    path: partial,
    clip: await around(sharp, "section.report", ".report .outcome"),
  });

  for (const file of [tour, reconstruction, recoveredSolution, partial]) {
    process.stdout.write(`Wrote ${file}\n`);
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(apps, { recursive: true, force: true });
}

/** Builds Fixture `name` and copies its Assembly's folder to one of the Assembly's name; resolves the copy's path. */
async function copyFixture(name: string): Promise<string> {
  const { assemblyPath } = await buildFixture(name);
  const folder = join(apps, basename(assemblyPath, extname(assemblyPath)));
  await cp(dirname(assemblyPath), folder, { recursive: true });
  return join(folder, basename(assemblyPath));
}

/** Reconstructs the Assembly at `path` in a newly loaded page, and waits for its outcome. */
async function reconstruct(page: Page, url: string, path: string) {
  await page.goto(url);
  await page.locator("#assembly-path").fill(path);
  await page.getByRole("button", { name: "Reconstruct", exact: true }).click();
  await page
    .locator(".report .outcome")
    .waitFor({ timeout: RECONSTRUCTION_TIMEOUT_MS });
}

/** Opens `file` from the Recovered Solution's tree in the code viewer, and waits for it to be shown. */
async function openFile(page: Page, file: string) {
  await page.getByRole("button", { name: file, exact: true }).click();
  await page.locator(".file-pane .monaco-editor .view-line").first().waitFor();
  // Monaco highlights a moment after it shows the text.
  await page.waitForTimeout(500);
}

async function scrollToTop(page: Page, selector: string) {
  await page
    .locator(selector)
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(100);
}

/**
 * The area from the top of `from` to the bottom of `to`, the width of `from`,
 * with a margin: less below, where the next heading may be close.
 */
async function around(page: Page, from: string, to: string) {
  const top = await page.locator(from).boundingBox();
  const bottom = await page.locator(to).boundingBox();
  if (top === null || bottom === null) {
    throw new Error(`${from} or ${to} is not shown.`);
  }
  const margin = 16;
  const y = Math.max(0, top.y - margin);
  return {
    x: Math.max(0, top.x - margin),
    y,
    width: top.width + 2 * margin,
    height: bottom.y + bottom.height + 8 - y,
  };
}
