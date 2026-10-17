import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { USAGE } from "@xray/cli";

import { BRAND_NAVY, SOCIAL_CARD, THEME_COLOURS } from "./brand.js";
import {
  FACTS,
  FAQ,
  FEATURES,
  FRAMEWORKS,
  OUTCOMES,
  PRINCIPLES,
  STAGES,
  type Card,
} from "./content.js";
import { githubMark, icon, iconSprite } from "./icons.js";
import { INSTALL_STEPS, REQUIREMENTS } from "./install.js";
import {
  NPM_URL,
  PACKAGE_NAME,
  REPOSITORY_ROOT,
  REPOSITORY_URL,
  SITE_DOMAIN,
  SITE_URL,
  repositoryFileUrl,
} from "./project.js";
import { SCREENSHOTS, TOUR, type Screenshot } from "./screenshots.js";
// The downloads each GitHub release carries, as @adrianeyre/xray's bundle.ts
// writes them, read from there so the site cannot link one it does not.
import { TARGETS, archiveName } from "../../xray/src/bundles.js";

// The project site (PRD §4: GitHub Pages hosts the project site, not the app):
// one page, written from what it describes, so it cannot drift from it: its
// CLI reference is `xray --help`, its install instructions are the ones
// verifyInstall runs, and its documentation is every PRD, ADR and reference
// document in docs/, linked on GitHub. Its own files are linked relatively, so
// it works wherever it is published. It needs no script: script.js only adds
// a menu on narrow screens, copy buttons, and policies in modal dialogs.

/** The site's static files, copied beside its page: its stylesheet and images. */
export const STATIC_DIRECTORY = fileURLToPath(
  new URL("../static/", import.meta.url),
);

/** Where `pnpm build:site` writes the site, for GitHub Pages to publish. */
export const SITE_DIRECTORY = fileURLToPath(
  new URL("../dist/", import.meta.url),
);

/** What the site, and Xray installed as an app, is called. */
export const SITE_NAME = "Xray";

/**
 * The page's title: what search engines list it by, and links to it unfurl
 * with. Under 60 characters, so no search engine cuts it short.
 */
export const SITE_TITLE =
  "Xray: turn .NET assemblies back into buildable C# solutions";

/**
 * What search engines show below the title, and links to it unfurl with:
 * under 160 characters, saying what Xray is in the words people search with.
 */
export const SITE_DESCRIPTION =
  "Free, open-source .NET decompiler: Xray turns compiled .exe and .dll files back into buildable, runnable C# solutions, on your own machine.";

/** Intended use (PRD §5), as the README and the UI state it. */
export const INTENDED_USE =
  "Xray is intended for Assemblies you own or have the right to analyse: recovering lost source for your own software, studying how C# features compile, or maintaining legacy internal applications. It does not undo obfuscation, or bypass licence checks or any other protection.";

export interface DocumentLink {
  /** Its path in the repository. */
  readonly path: string;
  /** Its title: its first heading. */
  readonly title: string;
}

export interface Documentation {
  readonly prd: DocumentLink;
  readonly adrs: readonly DocumentLink[];
  readonly glossary: DocumentLink;
  readonly reference: readonly DocumentLink[];
  readonly releasing: DocumentLink;
}

/** The documents the site links to, each titled by its first heading. */
export async function readDocumentation(): Promise<Documentation> {
  return {
    prd: await documentLink("docs/product-requirements-document/xray.md"),
    adrs: await documentLinks("docs/architectural-decision-record"),
    // Its heading is the product's name, as a glossary's context.
    glossary: { ...(await documentLink("GLOSSARY.md")), title: "Glossary" },
    reference: await documentLinks("docs/reference"),
    releasing: await documentLink("docs/processes/releasing.md"),
  };
}

async function documentLinks(folder: string): Promise<DocumentLink[]> {
  const files = (await readdir(join(REPOSITORY_ROOT, folder)))
    .filter((file) => file.endsWith(".md"))
    .sort();
  return Promise.all(files.map((file) => documentLink(`${folder}/${file}`)));
}

async function documentLink(path: string): Promise<DocumentLink> {
  const markdown = await readFile(join(REPOSITORY_ROOT, path), "utf8");
  const title = /^# (.+)$/m.exec(markdown)?.[1];
  if (title === undefined) {
    throw new Error(`${path} has no heading to title it by.`);
  }
  return { path, title: title.trim() };
}

/** The page's sections, as its header and footer link them: id, then label. */
const NAV: readonly (readonly [string, string])[] = [
  ["features", "Features"],
  ["how-it-works", "How it works"],
  ["screenshots", "Screenshots"],
  ["install", "Install"],
  ["cli", "CLI"],
  ["faq", "FAQ"],
  ["documentation", "Docs"],
];

/** Opening the web UI, once Xray is installed. */
const USE_UI = `xray ui                      # opens http://127.0.0.1:9729/ in your browser`;

/** Inspecting and reconstructing from the command line. */
const USE_CLI = [
  "xray inspect MyApp.dll       # its framework, references, PDB, obfuscation…",
  "xray reconstruct MyApp.exe -o ./out",
  "jq -r .outcome ./out/xray-report.json   # full, partial or unverified",
].join("\n");

/** Running Xray from a clone of its repository, as the README gives it. */
const FROM_SOURCE = [
  `git clone ${REPOSITORY_URL}.git`,
  "cd xray",
  "pnpm install",
  "pnpm start                   # builds everything, then runs xray ui",
].join("\n");

/** The download section's cards: each OS, and its heading. */
const DOWNLOAD_GROUPS = [
  ["windows", "Windows"],
  ["macos", "macOS"],
  ["linux", "Linux"],
] as const;

/** Where the latest release's download of `file` always is. */
export function latestDownload(file: string): string {
  return `${REPOSITORY_URL}/releases/latest/download/${file}`;
}

/** An OS's card: a button for each of its architectures, the first the most used. */
function downloadCard(
  os: (typeof DOWNLOAD_GROUPS)[number][0],
  title: string,
): string {
  const targets = TARGETS.filter((target) => target.os === os);
  return `<li class="card download">
              <span class="card-icon">${icon(os === "windows" ? "monitor" : os === "macos" ? "layout" : "terminal")}</span>
              <h4>${title}</h4>
              <ul class="download-links">
                ${targets
                  .map(
                    (target, index) =>
                      `<li><a class="button ${index === 0 ? "" : "button-secondary "}button-small" href="${latestDownload(archiveName(target))}" download>${icon("download")} ${escapeHtml(/\((.+)\)/.exec(target.label)?.[1] ?? target.label)}<span class="visually-hidden"> download for ${escapeHtml(title)}</span></a></li>`,
                  )
                  .join("\n                ")}
              </ul>
              ${targets[0] === undefined ? "" : `<p class="download-file"><code>${archiveName(targets[0])}</code></p>`}
            </li>`;
}

/** The site's page, `index.html`. */
export function renderPage(documentation: Documentation): string {
  const install = INSTALL_STEPS.map(
    (step) => `${step.command.padEnd(28)} # ${step.comment}`,
  ).join("\n");
  const [reconstruction = SCREENSHOTS[0] as Screenshot] = SCREENSHOTS;

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(SITE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${SITE_URL}" />
    <link rel="sitemap" type="application/xml" href="sitemap.xml" />

    <!-- How a link to the site unfurls: in Slack, Teams, Discord, LinkedIn, X and the like. -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:url" content="${SITE_URL}" />
    <meta property="og:title" content="${escapeHtml(SITE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta property="og:image" content="${SITE_URL}${SOCIAL_CARD.file}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="${SOCIAL_CARD.width}" />
    <meta property="og:image:height" content="${SOCIAL_CARD.height}" />
    <meta property="og:image:alt" content="${escapeHtml(SOCIAL_CARD.alt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(SITE_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(SITE_DESCRIPTION)}" />
    <meta name="twitter:image" content="${SITE_URL}${SOCIAL_CARD.file}" />
    <meta name="twitter:image:alt" content="${escapeHtml(SOCIAL_CARD.alt)}" />

    <!-- Its icon, on every browser and device. -->
    <link rel="icon" href="favicon.ico" sizes="48x48" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="apple-touch-icon.png" />
    <link rel="manifest" href="site.webmanifest" />
    <meta name="theme-color" content="${THEME_COLOURS.light}" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="${THEME_COLOURS.dark}" media="(prefers-color-scheme: dark)" />
    <meta name="msapplication-TileColor" content="${BRAND_NAVY}" />

    <script type="application/ld+json">
${structuredData()}
    </script>
    <link rel="preload" href="fonts/ibm-plex-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="style.css" />
    <script src="script.js" defer></script>
  </head>
  <body>
    ${iconSprite()}
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="site-header">
      <div class="container header-inner">
        <a class="brand" href="#top">
          <img src="favicon.svg" alt="" width="32" height="32" />
          <span>Xray</span>
        </a>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
          ${icon("menu", "icon icon-open")}${icon("close", "icon icon-close")}
          <span class="visually-hidden">Menu</span>
        </button>
        <nav class="site-nav" id="site-nav" aria-label="Sections">
          <ul>
            ${NAV.map(([href, label]) => `<li><a href="#${href}">${label}</a></li>`).join("\n            ")}
          </ul>
          <a class="button button-small" href="${REPOSITORY_URL}">${githubMark()} GitHub</a>
        </nav>
      </div>
    </header>

    <main id="main" tabindex="-1">
      <section class="hero" id="top" aria-labelledby="hero-title">
        <div class="hero-backdrop" aria-hidden="true"></div>
        <div class="container hero-inner">
          <div class="hero-text">
            <p class="eyebrow">${icon("sparkle")} Free and open source · Runs only on your machine</p>
            <h1 id="hero-title">Turn compiled .NET apps back into <span class="accent">buildable C#</span></h1>
            <p class="lead">
              Point Xray at a .NET <code>.exe</code> or <code>.dll</code>, or a folder holding an
              app and its DLLs. It decompiles it, resolves its dependencies, writes an SDK-style
              Visual Studio solution, and proves it with <code>dotnet build</code>. Where a perfect
              result isn't possible, it tells you exactly what's missing.
            </p>
            <div class="hero-actions">
              <a class="button button-large" href="#install">Install Xray ${icon("arrow-right")}</a>
              <a class="button button-secondary button-large" href="${REPOSITORY_URL}">${githubMark()} View on GitHub</a>
            </div>
            <div class="terminal">
              <pre tabindex="0" aria-label="Install Xray and check it can run"><code>${escapeHtml(install)}</code></pre>
            </div>
          </div>
          <figure class="hero-shot">
            ${browserWindow(reconstruction, false)}
            <figcaption><strong>A Full Reconstruction</strong>, stage by stage, in <code>xray ui</code>.</figcaption>
          </figure>
        </div>
        <div class="container">
          <ul class="facts" aria-label="At a glance">
            ${FACTS.map((fact) => `<li>${icon(fact.icon)}<span><strong>${fact.title}</strong> ${markdown(fact.text)}</span></li>`).join("\n            ")}
          </ul>
          <div class="frameworks">
            <p class="frameworks-title">Reconstructs</p>
            <ul class="chips">
              ${FRAMEWORKS.map((framework) => `<li>${escapeHtml(framework)}</li>`).join("\n              ")}
            </ul>
          </div>
        </div>
      </section>

      <section class="section" id="about" aria-labelledby="about-title">
        <div class="container">
          ${sectionHeading("about-title", "Why Xray", "More than a decompiler", "Recovering lost source, maintaining a legacy app nobody can build, or learning how C# compiles: Xray gives you back a solution, not just a listing.")}
          <ul class="card-grid card-grid-4">
            ${PRINCIPLES.map((card) => featureCard(card)).join("\n            ")}
          </ul>
        </div>
      </section>

      <section class="section section-alt" id="how-it-works" aria-labelledby="how-title">
        <div class="container">
          ${sectionHeading("how-title", "How it works", "From Assembly to solution, in six stages", "The pipeline the CLI runs and the web UI shows, live, stage by stage.")}
          <ol class="pipeline">
            ${STAGES.map(
              (stage, index) => `<li class="stage">
              <span class="stage-number" aria-hidden="true">${index + 1}</span>
              ${icon(stage.icon, "icon stage-icon")}
              <h3>${stage.name}</h3>
              <p>${markdown(stage.text)}</p>
            </li>`,
            ).join("\n            ")}
          </ol>
        </div>
      </section>

      <section class="section" id="features" aria-labelledby="features-title">
        <div class="container">
          ${sectionHeading("features-title", "Features", "Everything a Reconstruction needs", "Decompiling is the start. Xray resolves, rebuilds and reports, so what it gives you is something you can work on.")}
          <ul class="card-grid card-grid-3">
            ${FEATURES.map((card) => featureCard(card)).join("\n            ")}
          </ul>
        </div>
      </section>

      <section class="section section-alt" id="screenshots" aria-labelledby="screenshots-title">
        <div class="container">
          ${sectionHeading("screenshots-title", "Screenshots", "See it at work", "The web UI, reconstructing a WPF app and an app with a missing reference. Select a picture to see it full size.")}
          <div class="gallery">
            ${SCREENSHOTS.map(
              (screenshot) => `<figure class="gallery-item">
              ${browserWindow(screenshot, true)}
              <figcaption>${markdown(screenshot.caption)}</figcaption>
            </figure>`,
            ).join("\n            ")}
          </div>
          ${tour()}
        </div>
      </section>

      <section class="section" id="outcomes" aria-labelledby="outcomes-title">
        <div class="container">
          ${sectionHeading("outcomes-title", "Honest reporting", "Every Reconstruction says how it went", "Its outcome is in <code>xray-report.json</code>, in the web UI, and in the exit code of <code>xray reconstruct</code>, for scripts and CI.")}
          <ul class="card-grid card-grid-4">
            ${OUTCOMES.map(
              (
                outcome,
              ) => `<li class="card outcome" data-tone="${outcome.tone}">
              <p class="outcome-head">${icon(outcome.icon)}<span class="outcome-code">exit ${outcome.code}</span></p>
              <h3>${outcome.name}</h3>
              <p>${markdown(outcome.text)}</p>
            </li>`,
            ).join("\n            ")}
          </ul>
        </div>
      </section>

      <section class="section section-alt" id="install" aria-labelledby="install-title">
        <div class="container">
          ${sectionHeading("install-title", "Install", "Get started in minutes", `Download Xray for your OS, with everything it runs on, or install it from npm as <a href="${NPM_URL}"><code>${PACKAGE_NAME}</code></a>.`)}
          <h3 class="subheading">Download it</h3>
          <ul class="downloads">
            ${DOWNLOAD_GROUPS.map(([os, title]) => downloadCard(os, title)).join("\n            ")}
          </ul>
          <p class="downloads-note">
            Each download runs on its own, with the Node.js it ships with: unpack it, and run
            <code>xray doctor</code>. You need only the .NET SDK 8 or later. Check a download against
            the release&rsquo;s <a href="${REPOSITORY_URL}/releases/latest/download/SHA256SUMS.txt"><code>SHA256SUMS.txt</code></a>,
            or see <a href="${REPOSITORY_URL}/releases">every release</a>.
          </p>
          <h3 class="subheading">Or install it from npm</h3>
          <div class="install-grid">
            <div class="card">
              <h3>${icon("cpu")} You need</h3>
              <ul class="checklist">
                ${REQUIREMENTS.map((requirement) => `<li>${icon("check")} ${escapeHtml(requirement)}</li>`).join("\n                ")}
              </ul>
              <p class="note">Running a reconstructed Windows Forms or WPF program still needs Windows; building it does not.</p>
            </div>
            <div class="steps">
              <div class="step">
                <h3><span class="step-number">1</span> Install it, and check it can run</h3>
                <div class="terminal">
                  <pre tabindex="0" aria-label="Install Xray"><code>${escapeHtml(install)}</code></pre>
                </div>
              </div>
              <div class="step">
                <h3><span class="step-number">2</span> Open the web UI</h3>
                <div class="terminal">
                  <pre tabindex="0" aria-label="Open the web UI"><code>${escapeHtml(USE_UI)}</code></pre>
                </div>
              </div>
              <div class="step">
                <h3><span class="step-number">3</span> Or use the command line</h3>
                <div class="terminal">
                  <pre tabindex="0" aria-label="Inspect and reconstruct from the command line"><code>${escapeHtml(USE_CLI)}</code></pre>
                </div>
              </div>
            </div>
          </div>
          <details class="disclosure">
            <summary>Run it from source instead</summary>
            <p>With Node.js, pnpm, Git and a .NET SDK on your <code>PATH</code>:</p>
            <div class="terminal">
              <pre tabindex="0" aria-label="Run Xray from source"><code>${escapeHtml(FROM_SOURCE)}</code></pre>
            </div>
          </details>
        </div>
      </section>

      <section class="section" id="cli" aria-labelledby="cli-title">
        <div class="container">
          ${sectionHeading("cli-title", "CLI reference", "Every command and option", "What <code>xray --help</code> prints, word for word.")}
          <div class="terminal terminal-tall">
            <pre tabindex="0" aria-label="xray --help"><code>${linkDocuments(escapeHtml(USAGE))}</code></pre>
          </div>
        </div>
      </section>

      <section class="section section-alt" id="intended-use" aria-labelledby="intended-use-title">
        <div class="container narrow">
          ${sectionHeading("intended-use-title", "Responsible use", "Intended use", "")}
          <p class="intended-use">${icon("shield-check")} <span>${escapeHtml(INTENDED_USE)}</span></p>
          <h3>What Xray will not do</h3>
          <ul class="card-grid card-grid-3">
            ${featureCard({ icon: "cpu", title: "Native Executables", text: "C, C++, Rust, Go and the like are detected and rejected: compiled machine code cannot be turned back into runnable source." })}
            ${featureCard({ icon: "ban", title: "Deobfuscation", text: "Nor bypassing licence checks or protection: obfuscated input is flagged, and reconstructed as it is, never undone." })}
            ${featureCard({ icon: "lock", title: "A hosted service", text: "Xray runs only on your machine, and nothing you give it is uploaded anywhere. This site hosts no part of Xray." })}
          </ul>
        </div>
      </section>

      <section class="section" id="faq" aria-labelledby="faq-title">
        <div class="container narrow">
          ${sectionHeading("faq-title", "FAQ", "Questions, answered", "")}
          <div class="faq">
            ${FAQ.map(
              (item) => `<details>
              <summary><h3>${escapeHtml(item.question)}</h3></summary>
              <p>${markdown(item.answer)}</p>
            </details>`,
            ).join("\n            ")}
          </div>
        </div>
      </section>

      <section class="section section-alt" id="documentation" aria-labelledby="documentation-title">
        <div class="container">
          ${sectionHeading("documentation-title", "Documentation", "Go deeper", "Every document is on GitHub, as it is on <code>main</code>.")}
          <div class="docs-grid">
            <div class="card">
              <h3>${icon("book")} Start here</h3>
              <ul class="doc-list">
                <li>${documentAnchor(documentation.prd)}: scope, requirements, architecture and roadmap</li>
                <li>${documentAnchor(documentation.glossary)}: the project's vocabulary</li>
                <li>${documentAnchor(documentation.releasing)}</li>
              </ul>
            </div>
            <div class="card">
              <h3>${icon("terminal")} Reference</h3>
              <ul class="doc-list">
                ${documentation.reference.map((doc) => `<li>${documentAnchor(doc)}</li>`).join("\n                ")}
              </ul>
            </div>
            <div class="card">
              <h3>${icon("layers")} Architectural Decision Records</h3>
              <ul class="doc-list">
                ${documentation.adrs.map((adr) => `<li>${documentAnchor(adr)}</li>`).join("\n                ")}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section class="cta" aria-labelledby="cta-title">
        <div class="container cta-inner">
          <h2 id="cta-title">Get your source back</h2>
          <p>Free, open source, and nothing leaves your machine.</p>
          <div class="hero-actions">
            <a class="button button-large button-on-dark" href="#install">Install Xray ${icon("arrow-right")}</a>
            <a class="button button-secondary button-large button-on-dark-secondary" href="${REPOSITORY_URL}">${githubMark()} Star it on GitHub</a>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="container footer-grid">
        <div class="footer-brand">
          <a class="brand" href="#top"><img src="favicon.svg" alt="" width="32" height="32" /><span>Xray</span></a>
          <p>Turns compiled .NET applications back into buildable, runnable C# solutions.</p>
        </div>
        <nav class="footer-nav" aria-labelledby="footer-page">
          <h2 class="footer-heading" id="footer-page">On this page</h2>
          <ul>
            ${NAV.map(([href, label]) => `<li><a href="#${href}">${label}</a></li>`).join("\n            ")}
          </ul>
        </nav>
        <nav class="footer-nav" aria-labelledby="footer-project">
          <h2 class="footer-heading" id="footer-project">The project</h2>
          <ul>
            <li><a href="${REPOSITORY_URL}">Source on GitHub</a></li>
            <li><a href="${NPM_URL}">Package on npm</a></li>
            <li><a href="${REPOSITORY_URL}/issues">Issues</a></li>
            <li><a href="${REPOSITORY_URL}/releases">Releases</a></li>
            <li><a href="${repositoryFileUrl("CHANGELOG.md")}">Changelog</a></li>
          </ul>
        </nav>
        <nav class="footer-nav" aria-labelledby="footer-legal">
          <h2 class="footer-heading" id="footer-legal">Policies</h2>
          <ul>
            ${POLICIES.map((policy) => `<li><a href="#${policy.id}" data-dialog aria-haspopup="dialog">${policy.title}</a></li>`).join("\n            ")}
          </ul>
        </nav>
      </div>
      <div class="container footer-bottom">
        <p>
          MIT licence. Decompilation is powered by
          <a href="https://github.com/icsharpcode/ILSpy">ILSpy</a>'s
          <code>ICSharpCode.Decompiler</code> (MIT).
        </p>
      </div>
    </footer>

    ${POLICIES.map((policy) => policyDialog(policy)).join("\n    ")}
  </body>
</html>
`;
}

/** Writes the site to `directory`, replacing whatever it held: its page, stylesheet and images. */
export async function buildSite(
  directory: string = SITE_DIRECTORY,
): Promise<void> {
  const page = renderPage(await readDocumentation());
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await cp(STATIC_DIRECTORY, directory, { recursive: true });
  await writeFile(join(directory, "index.html"), page);
  await writeFile(join(directory, "sitemap.xml"), sitemap());
  // GitHub Pages serves the site at its own domain.
  await writeFile(join(directory, "CNAME"), `${SITE_DOMAIN}\n`);
}

/**
 * What Xray is, for search engines, as schema.org data: a free developer
 * application, its source, and the site about it.
 */
export function structuredData(): string {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "en-GB",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}#software`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        image: `${SITE_URL}${SOCIAL_CARD.file}`,
        screenshot: SCREENSHOTS.map(
          (screenshot) => `${SITE_URL}images/${screenshot.file}`,
        ),
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: ".NET decompiler",
        operatingSystem: "Windows, macOS, Linux",
        softwareRequirements: REQUIREMENTS.join("; "),
        downloadUrl: NPM_URL,
        installUrl: `${SITE_URL}#install`,
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
        sameAs: [REPOSITORY_URL, NPM_URL],
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${SITE_URL}#source`,
        name: SITE_NAME,
        codeRepository: REPOSITORY_URL,
        programmingLanguage: ["TypeScript", "C#"],
        license: "https://opensource.org/licenses/MIT",
        targetProduct: { "@id": `${SITE_URL}#software` },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}#faq`,
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer.replaceAll("`", ""),
          },
        })),
      },
    ],
  };
  // Safe inside <script>: no "</" can end it early.
  return JSON.stringify(data, null, 2).replaceAll("</", "<\\/");
}

/** The site's one page, for search engines to find it by. */
export function sitemap(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}</loc>
  </url>
</urlset>
`;
}

/** A section's eyebrow, heading and lead, centred above it. `lead` is HTML. */
function sectionHeading(
  id: string,
  eyebrow: string,
  title: string,
  lead: string,
): string {
  return `<div class="section-heading">
            <p class="eyebrow-text">${escapeHtml(eyebrow)}</p>
            <h2 id="${id}">${escapeHtml(title)}</h2>${
              lead === ""
                ? ""
                : `
            <p class="section-lead">${lead}</p>`
            }
          </div>`;
}

function featureCard(card: Card): string {
  return `<li class="card">
              <span class="card-icon">${icon(card.icon)}</span>
              <h3>${escapeHtml(card.title)}</h3>
              <p>${markdown(card.text)}</p>
            </li>`;
}

/**
 * A picture of the UI in a browser's frame, at its address, linked to itself
 * full size. Below the fold, it loads as it nears view; the hero's at once.
 */
function browserWindow(screenshot: Screenshot, lazy: boolean): string {
  const loading = lazy
    ? 'loading="lazy" decoding="async"'
    : 'fetchpriority="high" decoding="async"';
  return `<div class="window">
              <div class="window-bar" aria-hidden="true"><span></span><span></span><span></span><p class="window-address">127.0.0.1:9729</p></div>
              <a href="images/${screenshot.file}"><img src="images/${screenshot.file}" alt="${escapeHtml(screenshot.alt)}" width="${screenshot.width}" height="${screenshot.height}" ${loading} /></a>
            </div>`;
}

/**
 * The tour, an animation that loops, shown only once asked for and hidden
 * again by closing it, so nothing on the page moves unless the reader starts
 * it (WCAG 2.2.2).
 */
function tour(): string {
  return `<details class="tour">
            <summary>${icon("play")} Watch the tour: a whole Reconstruction in <code>xray ui</code> (animated)</summary>
            <figure>
              <img src="images/${TOUR.file}" alt="${escapeHtml(TOUR.alt)}" width="${TOUR.width}" height="${TOUR.height}" decoding="async" />
              <figcaption>${markdown(TOUR.caption)} Close the tour to stop it.</figcaption>
            </figure>
          </details>`;
}

interface Policy {
  readonly id: string;
  readonly title: string;
  /** Its body, as HTML. */
  readonly body: string;
}

/** When the policies were last changed. */
const POLICIES_UPDATED = "15 October 2026";

/** The site's policies: about this website, not Xray, which says its own in its UI. */
const POLICIES: readonly Policy[] = [
  {
    id: "privacy-policy",
    title: "Privacy Policy",
    body: `<p class="policy-lead">This website collects nothing about you. It has no analytics, no tracking, no advertising and no forms, and loads nothing from any other site: its fonts are served with it.</p>
          <h3>Who hosts it</h3>
          <p>It is hosted by GitHub Pages, which may log the IP address of each visit to keep its service secure, as <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</a> says. We never see those logs.</p>
          <h3>The links it has</h3>
          <p>Links to GitHub and npm take you to their sites, under their own privacy policies.</p>
          <h3>Xray itself</h3>
          <p>Xray runs only on your machine and uploads nothing you give it. Its own Privacy Policy is in its web UI.</p>
          <h3>Questions</h3>
          <p>Ask anything by <a href="${REPOSITORY_URL}/issues">opening an issue on GitHub</a>.</p>`,
  },
  {
    id: "terms",
    title: "Terms and Conditions",
    body: `<p class="policy-lead">This website describes Xray, which is free, open-source software under the MIT licence.</p>
          <h3>The software</h3>
          <p>Using Xray means accepting <a href="${repositoryFileUrl("LICENSE")}">its MIT licence</a>. It is provided as it is, without warranty of any kind; review a Recovered Solution before you rely on it.</p>
          <h3>Use it only where you have the right to</h3>
          <p>${escapeHtml(INTENDED_USE)} You are responsible for following the licence of any software you analyse, and the law where you are.</p>
          <h3>This website</h3>
          <p>What it says is given in good faith, and may change with new versions of Xray. .NET, Visual Studio, Windows and other names are trademarks of their owners.</p>`,
  },
  {
    id: "cookie-policy",
    title: "Cookie Policy",
    body: `<p class="policy-lead">This website sets no cookies, and stores nothing in your browser.</p>
          <p>It keeps no local or session storage, and has no analytics or tracking, so there is nothing to consent to, and no cookie banner.</p>`,
  },
  {
    id: "accessibility",
    title: "Accessibility Statement",
    body: `<p class="policy-lead">This website is built to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA.</p>
          <h3>What we have done</h3>
          <ul>
            <li><strong>Keyboard</strong>: everything can be reached and used with a keyboard, with a clear focus outline. &ldquo;Skip to main content&rdquo; is the first thing Tab reaches, and blocks of commands can be focused and scrolled.</li>
            <li><strong>Screen readers</strong>: headings and landmarks give the page its structure, every picture of the UI says what it shows, and icons beside words are hidden.</li>
            <li><strong>Contrast</strong>: text is at least 4.5:1 against its background, and controls and focus outlines at least 3:1, in light and dark mode, which follows your system.</li>
            <li><strong>Motion</strong>: nothing moves unless you start it: the animated tour plays only once opened, and closing it stops it. Smooth scrolling and transitions are off when your system asks for reduced motion.</li>
            <li><strong>Zoom and reflow</strong>: the page reflows to one column, and stays usable at 400% zoom or 320 pixels wide.</li>
            <li><strong>No script needed</strong>: everything on the page works without JavaScript.</li>
          </ul>
          <h3>Known limitations</h3>
          <p>Links to GitHub and npm go to sites we do not control. The CLI reference is preformatted text, as <code>xray --help</code> prints it.</p>
          <h3>Feedback</h3>
          <p>If something gets in your way, please <a href="${REPOSITORY_URL}/issues">open an issue on GitHub</a>, saying what you were doing and the browser and assistive technology you use.</p>`,
  },
];

/**
 * A policy, in a modal dialog that script.js opens from the footer. Without
 * script, the footer's link goes to it, and it shows in the page instead.
 */
function policyDialog(policy: Policy): string {
  return `<dialog class="policy" id="${policy.id}" aria-labelledby="${policy.id}-title">
      <div class="policy-frame">
        <header class="policy-header">
          <h2 id="${policy.id}-title">${policy.title}</h2>
          <button class="policy-close" type="button" data-close>${icon("close")}<span class="visually-hidden">Close ${policy.title}</span></button>
        </header>
        <div class="policy-body">
          <p class="policy-updated">Last updated ${POLICIES_UPDATED}.</p>
          ${policy.body}
        </div>
      </div>
    </dialog>`;
}

/** Plain text, with its Markdown `code` spans, as HTML. */
function markdown(text: string): string {
  return inlineCode(escapeHtml(text));
}

function documentAnchor(link: DocumentLink): string {
  return `<a href="${repositoryFileUrl(link.path)}">${inlineCode(escapeHtml(link.title))}</a>`;
}

/** Each `code` span in Markdown, as HTML. */
function inlineCode(html: string): string {
  return html.replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Each docs/ file `xray --help` names, linked on GitHub. */
function linkDocuments(html: string): string {
  return html.replace(
    /\bdocs\/[\w/-]+\.md\b/g,
    (path) => `<a href="${repositoryFileUrl(path)}">${path}</a>`,
  );
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
