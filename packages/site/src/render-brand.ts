// `pnpm --filter @xray/site brand`: writes Xray's icons, for every browser and
// device, and its social card, from brand.ts, in headless Chromium: the icons
// beside the site's page (static/) and the UI's (@xray/web's public/), the
// social card beside the site's only. Run it again when brand.ts or the
// reconstruction screenshot changes, with Chromium installed for Playwright:
//
//   pnpm --filter @xray/site exec playwright-core install chromium-headless-shell

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import {
  ICO_SIZES,
  ICON_SVG,
  RASTER_ICONS,
  SOCIAL_CARD,
  socialCardHtml,
  webManifest,
} from "./brand.js";
import { encodeIco } from "./ico.js";
import { SCREENSHOTS } from "./screenshots.js";
import { SITE_DESCRIPTION, SITE_NAME, STATIC_DIRECTORY } from "./site.js";

/** Where Vite copies the UI's own static files from, into its dist/. */
const WEB_PUBLIC = fileURLToPath(new URL("../../web/public/", import.meta.url));

const browser = await chromium.launch().catch((error: unknown) => {
  throw new Error(
    "Chromium could not be started. Install it for Playwright with `pnpm --filter @xray/site exec playwright-core install --with-deps chromium-headless-shell`.",
    { cause: error },
  );
});
try {
  const page = await browser.newPage();

  /** `svg`, drawn at `size` by `size` pixels, transparent where it is. */
  const png = async (svg: string, size: number): Promise<Buffer> => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    return page.screenshot({ omitBackground: true });
  };

  const files = new Map<string, Buffer | string>([
    ["favicon.svg", ICON_SVG],
    ["site.webmanifest", webManifest(SITE_NAME, SITE_DESCRIPTION)],
  ]);
  for (const icon of RASTER_ICONS) {
    files.set(icon.file, await png(icon.svg, icon.size));
  }
  // One at a time: each is drawn on the same page.
  const icoImages = [];
  for (const size of ICO_SIZES) {
    icoImages.push({ size, png: await png(ICON_SVG, size) });
  }
  files.set("favicon.ico", encodeIco(icoImages));
  for (const directory of [STATIC_DIRECTORY, WEB_PUBLIC]) {
    for (const [file, contents] of files) {
      await writeFile(join(directory, file), contents);
    }
  }

  // The social card, with the UI's report of a Full Reconstruction beside the words.
  const [reconstruction] = SCREENSHOTS;
  const screenshot = await readFile(
    join(STATIC_DIRECTORY, "images", reconstruction?.file ?? ""),
  );
  await page.setViewportSize({
    width: SOCIAL_CARD.width,
    height: SOCIAL_CARD.height,
  });
  await page.setContent(
    socialCardHtml(`data:image/png;base64,${screenshot.toString("base64")}`),
  );
  await writeFile(
    join(STATIC_DIRECTORY, SOCIAL_CARD.file),
    await page.screenshot(),
  );
  process.stdout.write(
    `Wrote ${files.size} icons to ${STATIC_DIRECTORY} and ${WEB_PUBLIC}, and ${SOCIAL_CARD.file} to ${STATIC_DIRECTORY}\n`,
  );
} finally {
  await browser.close();
}
