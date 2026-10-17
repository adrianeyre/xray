import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { USAGE } from "@xray/cli";
import { MINIMUM_DOTNET_SDK_MAJOR, MINIMUM_NODE_MAJOR } from "@xray/core";
import { describe, expect, it } from "vitest";

import {
  ICO_SIZES,
  ICON_FILES,
  ICON_SVG,
  RASTER_ICONS,
  SOCIAL_CARD,
  webManifest,
} from "./brand.js";
import { INSTALL_STEPS } from "./install.js";
import {
  NPM_URL,
  REPOSITORY_ROOT,
  REPOSITORY_URL,
  SITE_URL,
} from "./project.js";
import { SCREENSHOTS, TOUR } from "./screenshots.js";
import { FAQ } from "./content.js";
import { TARGETS, archiveName } from "../../xray/src/bundles.js";
import {
  INTENDED_USE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  STATIC_DIRECTORY,
  buildSite,
  latestDownload,
  readDocumentation,
  renderPage,
} from "./site.js";

// Holds the site to what it describes: the CLI's help, the install
// instructions verifyInstall runs, and the documents in the repository.
// Whether those instructions work is tested where the package is packed, in
// @adrianeyre/xray's tests, and after each release by the CI workflow.

const page = renderPage(await readDocumentation());

/** The text of `html`, as a browser shows it, tags left out. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

/** The contents of each `<pre>` on the page, as text. */
function preformatted(html: string): string[] {
  return [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((match) =>
    text(match[1] ?? ""),
  );
}

function repositoryFile(path: string): Promise<string> {
  return readFile(join(REPOSITORY_ROOT, path), "utf8");
}

/** The commands of the first ```bash block after `heading`, comments left out. */
function commandsAfter(markdown: string, heading: string): string[] {
  const section = markdown.slice(markdown.indexOf(heading));
  const block = /```bash\n([\s\S]*?)```/.exec(section)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line !== "");
}

describe("the project site", () => {
  it("gives what `xray --help` prints as its CLI reference, word for word", () => {
    expect(preformatted(page)).toContain(USAGE);
  });

  it("links each docs/ file the CLI reference names, on GitHub", async () => {
    const named = [...USAGE.matchAll(/\bdocs\/[\w/-]+\.md\b/g)].map(
      (match) => match[0],
    );

    expect(named).not.toEqual([]);
    for (const path of named) {
      expect(page).toContain(
        `<a href="${REPOSITORY_URL}/blob/main/${path}">${path}</a>`,
      );
      await expect(stat(join(REPOSITORY_ROOT, path))).resolves.toBeTruthy();
    }
  });

  it("gives the install instructions verifyInstall runs, and what xray doctor checks the machine has", () => {
    const [install] = preformatted(page);
    const commands = (install ?? "")
      .split("\n")
      .map((line) => line.replace(/#.*$/, "").trim());

    expect(commands).toEqual(INSTALL_STEPS.map((step) => step.command));
    expect(text(page)).toContain(`Node.js ${MINIMUM_NODE_MAJOR} or later`);
    expect(text(page)).toContain(
      `.NET SDK ${MINIMUM_DOTNET_SDK_MAJOR} or later`,
    );
  });

  it("links the PRD, every ADR, the glossary and every reference document, each a file on main", async () => {
    const linked = [
      ...page.matchAll(
        new RegExp(`href="${REPOSITORY_URL}/blob/main/([^"]+)"`, "g"),
      ),
    ].map((match) => match[1] as string);
    const folder = async (path: string) =>
      (await readdir(join(REPOSITORY_ROOT, path)))
        .filter((file) => file.endsWith(".md"))
        .map((file) => `${path}/${file}`);

    expect(linked).toEqual(
      expect.arrayContaining([
        "docs/product-requirements-document/xray.md",
        ...(await folder("docs/architectural-decision-record")),
        "GLOSSARY.md",
        ...(await folder("docs/reference")),
        "docs/processes/releasing.md",
      ]),
    );
    for (const path of linked) {
      await expect(
        stat(join(REPOSITORY_ROOT, path)),
        path,
      ).resolves.toBeTruthy();
    }
  });

  it("titles each ADR by its heading", async () => {
    const adr = await repositoryFile(
      "docs/architectural-decision-record/0003-local-only-web-ui.md",
    );
    const title = /^# (.+)$/m.exec(adr)?.[1] ?? "";

    expect(title).not.toBe("");
    expect(page).toContain(
      `<a href="${REPOSITORY_URL}/blob/main/docs/architectural-decision-record/0003-local-only-web-ui.md">${title}</a>`,
    );
  });

  it("states the intended use, as the README and the web UI do", async () => {
    const readme = await repositoryFile("README.md");
    const ui = (await repositoryFile("packages/web/src/App.tsx")).replace(
      /\s+/g,
      " ",
    );

    expect(text(page)).toContain(INTENDED_USE);
    expect(readme).toContain(
      "Xray is intended for Assemblies you own or have the right to analyse.",
    );
    expect(INTENDED_USE).toMatch(
      /^Xray is intended for Assemblies you own or have the right to analyse: /,
    );
    expect(ui).toContain(INTENDED_USE.slice(INTENDED_USE.indexOf(": ") + 2));
  });

  it("is in British English, and skips to its main content from the first Tab", () => {
    expect(page).toContain('<html lang="en-GB">');
    expect(page).toMatch(
      /<body>\s*<svg class="sprite"[\s\S]*?<\/svg>\s*<a class="skip-link" href="#main">Skip to main content<\/a>/,
    );
    expect(page).toContain('<main id="main" tabindex="-1">');
  });

  it("lets every block of commands be scrolled sideways from the keyboard", () => {
    const pres = [...page.matchAll(/<pre[^>]*>/g)].map((match) => match[0]);
    expect(pres.length).toBeGreaterThan(0);
    expect(pres.every((pre) => pre.includes('tabindex="0"'))).toBe(true);
  });

  it("plays the looping tour only once asked to, and stops it when it is closed", () => {
    expect(page).toMatch(
      new RegExp(
        `<details class="tour">\\s*<summary>[\\s\\S]*?<code>xray ui</code> \\(animated\\)</summary>\\s*<figure>\\s*<img src="images/${TOUR.file}"`,
      ),
    );
    expect(page).not.toMatch(/<details[^>]* open/);
  });

  it("shows each picture of the UI it names, with words for those who cannot see it, and ships no other", async () => {
    const images = [TOUR, ...SCREENSHOTS];
    const shown = [
      ...page.matchAll(/<img src="images\/([^"]+)" alt="([^"]+)"/g),
    ];

    // Each once in the gallery, the tour last; the first also in the hero.
    expect([...new Set(shown.map((match) => match[1]))].sort()).toEqual(
      images.map((image) => image.file).sort(),
    );
    expect(shown.every((match) => (match[2] ?? "").length > 40)).toBe(true);
    expect((await readdir(join(STATIC_DIRECTORY, "images"))).sort()).toEqual(
      images.map((image) => image.file).sort(),
    );
  });

  it("links its own files relatively, so it works at whatever path Pages publishes it", () => {
    const own = [...page.matchAll(/(?:href|src)="([^"#][^"]*)"/g)]
      .map((match) => match[1] as string)
      .filter((url) => !/^https:\/\//.test(url));

    expect(own).toEqual(expect.arrayContaining(["style.css"]));
    expect(
      own.filter((url) => url.startsWith("/") || url.includes("..")),
    ).toEqual([]);
  });

  it("is built into a folder of its page, its stylesheet and its pictures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xray-site-"));
    try {
      await buildSite(directory);

      expect(await readFile(join(directory, "index.html"), "utf8")).toBe(page);
      expect((await readdir(directory)).sort()).toEqual(
        [
          ...ICON_FILES,
          SOCIAL_CARD.file,
          "CNAME",
          "fonts",
          "script.js",
          "images",
          "index.html",
          "sitemap.xml",
          "style.css",
        ].sort(),
      );
      expect(await readFile(join(directory, "CNAME"), "utf8")).toBe(
        "xray.adrianeyre.co.uk\n",
      );
      expect(await readFile(join(directory, "sitemap.xml"), "utf8")).toContain(
        `<loc>${SITE_URL}</loc>`,
      );
      expect((await readdir(join(directory, "images"))).sort()).toEqual(
        [TOUR, ...SCREENSHOTS].map((image) => image.file).sort(),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** The `content` of the `<meta>` whose `name` or `property` is `key`. */
function meta(key: string): string | undefined {
  const tag = new RegExp(
    `<meta (?:name|property)="${key.replaceAll(":", "\\:")}" content="([^"]*)"`,
  ).exec(page);
  return tag?.[1];
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("the project site's page", () => {
  it("links each download of the latest release, for every OS and architecture", () => {
    for (const target of TARGETS) {
      expect(page).toContain(
        `href="${REPOSITORY_URL}/releases/latest/download/${archiveName(target)}" download`,
      );
    }
    expect(latestDownload("SHA256SUMS.txt")).toBe(
      `${REPOSITORY_URL}/releases/latest/download/SHA256SUMS.txt`,
    );
    expect(page).toContain(`href="${latestDownload("SHA256SUMS.txt")}"`);
  });

  it("answers each question, in the page and to search engines", () => {
    const json =
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
        page,
      )?.[1];
    const faq = (
      JSON.parse(json ?? "") as {
        "@graph": { "@type": string; mainEntity?: { name: string }[] }[];
      }
    )["@graph"].find((node) => node["@type"] === "FAQPage");

    expect(faq?.mainEntity?.map((question) => question.name)).toEqual(
      FAQ.map((item) => item.question),
    );
    for (const item of FAQ) {
      expect(page).toContain(
        `<summary><h3>${item.question.replaceAll('"', "&quot;")}</h3></summary>`,
      );
    }
  });

  it("has each policy in a dialog the footer links to, which shows without script", () => {
    for (const id of [
      "privacy-policy",
      "terms",
      "cookie-policy",
      "accessibility",
    ]) {
      expect(page).toContain(
        `<dialog class="policy" id="${id}" aria-labelledby="${id}-title">`,
      );
      expect(page).toContain(
        `<a href="#${id}" data-dialog aria-haspopup="dialog">`,
      );
    }
  });

  it("names each section in its header's navigation, each a section of the page", () => {
    const nav = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
    const targets = [...nav.matchAll(/href="#([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(targets.length).toBeGreaterThanOrEqual(6);
    for (const id of targets) {
      expect(page).toContain(`id="${id}"`);
    }
  });

  it("loads nothing from any other site: no scripts, stylesheets or fonts", () => {
    const loaded = [
      ...page.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="([^"]+)"/g),
    ]
      .map((match) => match[1] as string)
      .filter((url) => !url.startsWith(SITE_URL));
    expect(loaded.filter((url) => /^(?:https?:)?\/\//.test(url))).toEqual([]);
  });
});

describe("the project site, to search engines and link previews", () => {
  it("has a title and a description short enough not to be cut, saying what Xray is", () => {
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
    expect(SITE_DESCRIPTION.length).toBeGreaterThanOrEqual(70);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(SITE_DESCRIPTION).toMatch(/\.NET/);
    expect(SITE_DESCRIPTION).toMatch(/C#/);
    expect(page).toContain(`<title>${SITE_TITLE}</title>`);
    expect(meta("description")).toBe(SITE_DESCRIPTION);
    expect(page).toContain(`<link rel="canonical" href="${SITE_URL}" />`);
    expect(meta("robots")).toBe("index, follow, max-image-preview:large");
  });

  it("unfurls, in Slack and the like, with its title, its description and the social card", () => {
    const card = `${SITE_URL}${SOCIAL_CARD.file}`;
    expect(meta("og:type")).toBe("website");
    expect(meta("og:site_name")).toBe(SITE_NAME);
    expect(meta("og:url")).toBe(SITE_URL);
    expect(meta("og:title")).toBe(SITE_TITLE);
    expect(meta("og:description")).toBe(SITE_DESCRIPTION);
    expect(meta("og:image")).toBe(card);
    expect(meta("og:image:width")).toBe("1200");
    expect(meta("og:image:height")).toBe("630");
    expect(meta("og:image:alt")).toBe(SOCIAL_CARD.alt.replaceAll("'", "'"));
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(meta("twitter:image")).toBe(card);
  });

  it("ships a social card of the size every preview expects", async () => {
    expect(
      pngSize(await readFile(join(STATIC_DIRECTORY, SOCIAL_CARD.file))),
    ).toEqual({ width: 1200, height: 630 });
  });

  it("describes Xray as free software, its source and the site, as schema.org data", () => {
    const json =
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
        page,
      )?.[1];
    const data = JSON.parse(json ?? "") as {
      "@context": string;
      "@graph": { "@type": string; [key: string]: unknown }[];
    };

    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@graph"].map((node) => node["@type"])).toEqual([
      "WebSite",
      "SoftwareApplication",
      "SoftwareSourceCode",
      "FAQPage",
    ]);
    expect(data["@graph"][1]).toMatchObject({
      name: "Xray",
      url: SITE_URL,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Windows, macOS, Linux",
      downloadUrl: NPM_URL,
      offers: { "@type": "Offer", price: "0" },
      screenshot: SCREENSHOTS.map((shot) => `${SITE_URL}images/${shot.file}`),
    });
    expect(data["@graph"][2]).toMatchObject({ codeRepository: REPOSITORY_URL });
  });

  it("gives each picture its size, so nothing moves as they load", () => {
    for (const image of [TOUR, ...SCREENSHOTS]) {
      expect(page).toContain(
        `src="images/${image.file}" alt="${image.alt.replaceAll('"', "&quot;")}" width="${image.width}" height="${image.height}"`,
      );
    }
  });

  it("gives every picture the size it says it is", async () => {
    for (const image of [TOUR, ...SCREENSHOTS]) {
      const file = await readFile(join(STATIC_DIRECTORY, "images", image.file));
      const size = image.file.endsWith(".gif")
        ? { width: file.readUInt16LE(6), height: file.readUInt16LE(8) }
        : pngSize(file);
      expect(size).toEqual({ width: image.width, height: image.height });
    }
  });
});

describe("Xray's icons", () => {
  const web = join(REPOSITORY_ROOT, "packages/web/public");

  it("are linked from the site's page, for every browser and device", () => {
    expect(page).toContain(
      '<link rel="icon" href="favicon.ico" sizes="48x48" />',
    );
    expect(page).toContain(
      '<link rel="icon" href="favicon.svg" type="image/svg+xml" />',
    );
    expect(page).toContain(
      '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
    );
    expect(page).toContain('<link rel="manifest" href="site.webmanifest" />');
    expect(page).toMatch(
      /<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: light\)" \/>/,
    );
    expect(page).toMatch(
      /<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: dark\)" \/>/,
    );
  });

  it("are linked from the UI's page", async () => {
    const html = await repositoryFile("packages/web/index.html");
    for (const link of [
      'href="/favicon.ico"',
      'href="/favicon.svg"',
      'href="/apple-touch-icon.png"',
      'href="/site.webmanifest"',
    ]) {
      expect(html).toContain(link);
    }
  });

  it("are written from brand.ts, the same beside the site and the UI", async () => {
    expect(await readFile(join(STATIC_DIRECTORY, "favicon.svg"), "utf8")).toBe(
      ICON_SVG,
    );
    expect(
      await readFile(join(STATIC_DIRECTORY, "site.webmanifest"), "utf8"),
    ).toBe(webManifest(SITE_NAME, SITE_DESCRIPTION));
    for (const file of ICON_FILES) {
      expect(await readFile(join(web, file))).toEqual(
        await readFile(join(STATIC_DIRECTORY, file)),
      );
    }
  });

  it("are each the size they are named for", async () => {
    for (const icon of RASTER_ICONS) {
      expect(
        pngSize(await readFile(join(STATIC_DIRECTORY, icon.file))),
      ).toEqual({ width: icon.size, height: icon.size });
    }
  });

  it("hold every size of favicon.ico, as PNGs", async () => {
    const ico = await readFile(join(STATIC_DIRECTORY, "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    expect(ico.readUInt16LE(4)).toBe(ICO_SIZES.length);
    ICO_SIZES.forEach((size, index) => {
      const entry = 6 + 16 * index;
      expect([ico.readUInt8(entry), ico.readUInt8(entry + 1)]).toEqual([
        size,
        size,
      ]);
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + ico.readUInt32LE(entry + 8));
      expect(pngSize(png)).toEqual({ width: size, height: size });
    });
  });

  it("name Xray, and are each listed, when it is installed or pinned", () => {
    const manifest = JSON.parse(webManifest(SITE_NAME, SITE_DESCRIPTION)) as {
      name: string;
      icons: { src: string; purpose?: string }[];
    };
    expect(manifest.name).toBe("Xray");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "favicon.svg",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
    ]);
    expect(manifest.icons.at(-1)?.purpose).toBe("maskable");
  });
});

describe("the README", () => {
  it("shows the social card and every screenshot of the UI, with words for those who cannot see them", async () => {
    const readme = await repositoryFile("README.md");
    const images = [...readme.matchAll(/!\[([^\]]+)\]\(([^)]+)\)/g)].map(
      (match) => ({ alt: match[1] ?? "", path: match[2] ?? "" }),
    );

    expect(images.map((image) => image.path)).toEqual([
      `packages/site/static/${SOCIAL_CARD.file}`,
      ...SCREENSHOTS.map((shot) => `packages/site/static/images/${shot.file}`),
    ]);
    expect(images.every((image) => image.alt.length > 40)).toBe(true);
    for (const image of images) {
      await expect(
        stat(join(REPOSITORY_ROOT, image.path)),
      ).resolves.toBeTruthy();
    }
  });

  it("links the project site, at the domain GitHub Pages publishes it at", async () => {
    expect(SITE_URL).toBe("https://xray.adrianeyre.co.uk/");
    expect(await repositoryFile("README.md")).toContain(`](${SITE_URL})`);
  });

  it("gives the same install commands as the site, as do the package's README and docs/processes/releasing.md", async () => {
    const commands = INSTALL_STEPS.map((step) => step.command);

    expect(
      commandsAfter(await repositoryFile("README.md"), "## Install"),
    ).toEqual(commands);
    expect(
      commandsAfter(
        await repositoryFile("packages/xray/README.md"),
        "## Install",
      ),
    ).toEqual(commands);
    expect(
      commandsAfter(
        await repositoryFile("docs/processes/releasing.md"),
        "# Releasing",
      ),
    ).toEqual(commands);
  });
});

describe("the repository", () => {
  it("is named xray everywhere, its old name, temp, left only to the PRD, which says it was to be renamed", async () => {
    const { stdout } = await promisify(execFile)("git", ["ls-files", "-z"], {
      cwd: REPOSITORY_ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    const files = stdout.split("\0").filter((path) => path !== "");
    expect(files).toContain("README.md");

    const naming = [];
    for (const path of files) {
      const contents = await repositoryFile(path).catch(() => "");
      if (/adrianeyre\/temp\b|adrianeyre\.github\.io\/temp\b/.test(contents)) {
        naming.push(path);
      }
    }

    expect(REPOSITORY_URL).toBe("https://github.com/adrianeyre/xray");
    expect(naming).toEqual(["docs/product-requirements-document/xray.md"]);
  });
});
