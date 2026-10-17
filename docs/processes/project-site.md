# The project site

Xray's project site is published to GitHub Pages at [xray.adrianeyre.co.uk](https://xray.adrianeyre.co.uk/). It says what Xray is, shows its UI, gives the install instructions and the CLI reference, states its intended use, and links the PRD, the ADRs and the rest of `docs/`. It is a static page and nothing more: GitHub Pages hosts the project site, never the app, which runs only on the user's machine (PRD §4, ADR 0003).

---

## What it is built from

The site is `packages/site/` (`@xray/site`, private, never published). [`site.ts`](../../packages/site/src/site.ts) writes its one page from what it describes, so it cannot drift from it:

| On the page | Where it comes from |
| --- | --- |
| The CLI reference | `xray --help`, word for word: the CLI's own `USAGE`. |
| The install instructions | [`install.ts`](../../packages/site/src/install.ts), the commands that are verified (below); the README, the package's README and [Releasing](releasing.md) must give the same ones. |
| What Xray needs | The Node.js version and the .NET SDK major version `xray doctor` checks. |
| The documentation | The PRD, every ADR in `docs/architectural-decision-record/`, the glossary, every document in `docs/reference/`, and [Releasing](releasing.md), each titled by its first heading and linked on GitHub, on `main`. |
| The screenshots and the animation | `packages/site/static/images/`, written from the UI itself (below). |
| Its address, and the repository it links | `repository` in `packages/xray/package.json`. |

Its tests ([`site.test.ts`](../../packages/site/src/site.test.ts)) hold the page to each of these, and the README to linking it. To build it into `packages/site/dist/` and look at it:

```bash
pnpm build:site
```

Then open `packages/site/dist/index.html`. It links its own files relatively, so it works there as it does on Pages.

---

## The screenshots

The pictures of the UI are [captured](../../packages/site/src/capture-screenshots.ts) from `xray ui` itself, in headless Chromium, reconstructing two Fixtures: the wpf Fixture, a Full Reconstruction, for the animation, the pipeline and the Recovered Solution, and the missing-reference Fixture, a Partial one. They are committed, so building the site in CI needs neither .NET nor a browser. When the UI changes, capture them again:

```bash
pnpm build:engine
pnpm build:web
pnpm --filter @xray/site exec playwright-core install --with-deps chromium-headless-shell
pnpm --filter @xray/site capture
```

and commit what it wrote. Each picture's description, for those who cannot see it, and its caption are in [`screenshots.ts`](../../packages/site/src/screenshots.ts); change them if what it shows changes.

---

## Search engines and link previews

The page's `<head>` is written from [`site.ts`](../../packages/site/src/site.ts), and its tests hold it to these:

- **Search engines**: a title under 60 characters and a description under 160, saying what Xray is in the words people search with (`SITE_TITLE`, `SITE_DESCRIPTION`); a canonical link to the site's address; and schema.org data (JSON-LD) describing Xray as a free `SoftwareApplication`, its `SoftwareSourceCode` and the `WebSite`. `pnpm build:site` writes a `sitemap.xml` beside the page. Each picture has its width and height, so nothing moves as it loads.
- **Link previews**: Open Graph and Twitter card tags, so a link to the site pasted into Slack, Teams, Discord, LinkedIn or X unfurls with the title, the description and the social card, `static/social-card.png`, 1200 by 630 pixels.
- **Icons**: `favicon.ico` (16, 32 and 48 pixels), `favicon.svg`, PNGs from 16 to 512 pixels, Apple's touch icon, a maskable icon for Android, and `site.webmanifest`, with a theme colour for light and dark. The UI links the same icons, from `packages/web/public/`.

The icons and the social card are drawn from [`brand.ts`](../../packages/site/src/brand.ts), Xray's mark, in headless Chromium, and committed. When the mark, the words on the card, or the reconstruction screenshot change, write them again:

```bash
pnpm --filter @xray/site exec playwright-core install chromium-headless-shell
pnpm --filter @xray/site brand
```

A link to the repository on GitHub, rather than to the site, unfurls with the repository's own social preview, which only GitHub's settings can set: upload `packages/site/static/social-card.png` under **Settings → General → Social preview**.

---

## How it is published

The [CI workflow](../../.github/workflows/ci.yml) builds the site and deploys it to GitHub Pages on every push to `main`, once the checks on every OS pass. It can also be run by hand on `main`, from the repository's _Actions_ tab.

---

## How the install instructions are verified

The instructions are run as they are written, by [`verify-install.ts`](../../packages/site/src/verify-install.ts): `pnpm add -g @adrianeyre/xray` into a `PNPM_HOME` of their own, as on a machine that has never installed Xray, then `xray doctor`, which must pass; then `xray --help` must print the site's CLI reference. They are run:

- **Before a version is published**, by `@adrianeyre/xray`'s tests, against the tarball `pnpm publish` would upload, in place of the package's name, on Windows, macOS and Linux in CI.
- **Once a version is published**, by the [CI workflow](../../.github/workflows/ci.yml)'s `verify-install` job, against that version on npm, on Windows, macOS and Linux. It runs after the workflow releases a version; to check a version already on npm, such as the first one, which is published by hand ([Releasing](releasing.md)), run the CI workflow by hand, from the _Actions_ tab, with that version as _verify-install_.

To run them on this machine, against the version npm tags `latest`, or with `--package`, a version or a tarball in its place:

```bash
pnpm --filter @xray/site verify-install
pnpm --filter @xray/site verify-install --package @adrianeyre/xray@1.0.0
```

---

## Setting up, once

By an owner of the repository: in its _Settings → Pages_, under _Build and deployment_, set _Source_ to _GitHub Actions_. Then run the CI workflow on `main`, or push to `main`.

It is published at its own domain, [xray.adrianeyre.co.uk](https://xray.adrianeyre.co.uk/): `SITE_DOMAIN` in [`project.ts`](../../packages/site/src/project.ts), which `pnpm build:site` writes to the site's `CNAME`. Once, in the DNS for `adrianeyre.co.uk`, add a `CNAME` record from `xray` to `adrianeyre.github.io`; then, in the repository's **Settings → Pages**, set **Custom domain** to `xray.adrianeyre.co.uk` and, once GitHub has issued its certificate, tick **Enforce HTTPS**.
