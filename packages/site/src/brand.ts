// Xray's mark, as the icons and the social card are drawn from: `</>`, the
// code it recovers, in green on navy, as the UI's header shows it. Every
// picture render-brand.ts writes comes from here, so they cannot drift apart.

/** The mark's navy: the UI's text colour, its header mark's square. */
export const BRAND_NAVY = "#0f172a";
/** The mark's green: the UI's primary colour in dark mode, 9:1 on the navy. */
export const BRAND_GREEN = "#22c55e";
/** The page's own background, light and dark, for the browser's chrome. */
export const THEME_COLOURS = { light: "#f8fafc", dark: "#0b1120" } as const;

/**
 * The mark's strokes, on a 32 by 32 grid: a bracket each side, a slash
 * between, clear of both even at 16 pixels. The UI's header draws the same.
 */
export const GLYPH_PATH =
  "M10 10l-4.5 6 4.5 6M22 10l4.5 6-4.5 6M17.8 10.5l-3.6 11";

const GLYPH = `<path d="${GLYPH_PATH}" fill="none" stroke="${BRAND_GREEN}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The icon: the mark on a rounded navy square, for tabs, bookmarks and home screens. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${BRAND_NAVY}"/>${GLYPH}</svg>
`;

/**
 * The icon for Android's adaptive icons, which crop it to any shape: navy to
 * every edge, and the mark inside the middle 80%, the part never cropped.
 */
export const MASKABLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BRAND_NAVY}"/><g transform="translate(16 16) scale(0.62) translate(-16 -16)">${GLYPH}</g></svg>
`;

/**
 * Apple's touch icon, which iOS rounds itself and shows on a black square
 * where it is transparent: navy to every edge, the mark a little inset.
 */
export const APPLE_TOUCH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BRAND_NAVY}"/><g transform="translate(16 16) scale(0.8) translate(-16 -16)">${GLYPH}</g></svg>
`;

export interface RasterIcon {
  /** Its file, beside the page. */
  readonly file: string;
  /** Its width and height, in pixels. */
  readonly size: number;
  readonly svg: string;
}

/** Every PNG icon, for the browsers and devices that do not take the SVG. */
export const RASTER_ICONS: readonly RasterIcon[] = [
  { file: "favicon-16.png", size: 16, svg: ICON_SVG },
  { file: "favicon-32.png", size: 32, svg: ICON_SVG },
  { file: "favicon-48.png", size: 48, svg: ICON_SVG },
  { file: "apple-touch-icon.png", size: 180, svg: APPLE_TOUCH_ICON_SVG },
  { file: "icon-192.png", size: 192, svg: ICON_SVG },
  { file: "icon-512.png", size: 512, svg: ICON_SVG },
  { file: "icon-maskable-512.png", size: 512, svg: MASKABLE_ICON_SVG },
];

/** The sizes favicon.ico holds, for old browsers and whatever asks for /favicon.ico. */
export const ICO_SIZES = [16, 32, 48] as const;

/** Every icon file, beside the page, the site's and the UI's alike. */
export const ICON_FILES = [
  "favicon.svg",
  "favicon.ico",
  ...RASTER_ICONS.map((icon) => icon.file),
  "site.webmanifest",
] as const;

/** The web app manifest: what a phone or desktop names and shows Xray as when it is installed or pinned. */
export function webManifest(name: string, description: string): string {
  return `${JSON.stringify(
    {
      name,
      short_name: "Xray",
      description,
      start_url: ".",
      scope: ".",
      display: "standalone",
      background_color: THEME_COLOURS.dark,
      theme_color: BRAND_NAVY,
      icons: [
        { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        {
          src: "icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    null,
    2,
  )}\n`;
}

/** The picture a link to the site unfurls with, in Slack, social media and chat apps. */
export const SOCIAL_CARD = {
  file: "social-card.png",
  width: 1200,
  height: 630,
  alt: "Xray: turn compiled .NET applications back into buildable C# solutions. Beside the words, Xray's web UI shows a Reconstruction's stages, each done, and its report.",
} as const;

/**
 * The social card, as a page for Chromium to photograph at 1200 by 630: the
 * mark and the name, what Xray does, and the UI beside it, from `screenshot`,
 * a data: URL of a picture of it.
 */
export function socialCardHtml(screenshot: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${SOCIAL_CARD.width}px; height: ${SOCIAL_CARD.height}px; overflow: hidden; }
  body {
    position: relative;
    display: grid;
    grid-template-columns: 560px 1fr;
    gap: 40px;
    padding: 64px 0 0 72px;
    background:
      radial-gradient(800px 500px at 100% 0%, rgb(34 197 94 / 16%), transparent 60%),
      linear-gradient(160deg, #0f172a, #0b1120 70%);
    color: #f1f5f9;
    font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand svg { width: 64px; height: 64px; }
  .brand span { font: 700 44px/1 "JetBrains Mono", "Cascadia Code", ui-monospace, monospace; letter-spacing: -0.02em; }
  h1 { margin-top: 44px; font-size: 52px; line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; }
  h1 em { font-style: normal; color: ${BRAND_GREEN}; }
  p { margin-top: 24px; font-size: 25px; line-height: 1.4; color: #a3b1c6; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
  .chips span { padding: 8px 14px; border: 1px solid #334260; border-radius: 999px; font-size: 19px; color: #cbd5e1; }
  .shot {
    align-self: start;
    width: 760px;
    margin-top: 6px;
    border: 1px solid #334260;
    border-radius: 16px;
    box-shadow: 0 30px 80px rgb(0 0 0 / 55%);
    overflow: hidden;
  }
  .shot img { display: block; width: 100%; }
</style>
</head>
<body>
  <div>
    <div class="brand">${ICON_SVG.trim()}<span>Xray</span></div>
    <h1>Turn compiled .NET apps back into <em>buildable C#</em></h1>
    <p>Decompile, resolve dependencies and rebuild with dotnet build, all on your own machine.</p>
    <div class="chips"><span>Open source</span><span>CLI + web UI</span><span>WinForms &amp; WPF</span></div>
  </div>
  <div class="shot"><img src="${screenshot}" alt="" /></div>
</body>
</html>
`;
}
