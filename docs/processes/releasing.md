# Releasing

Xray is published to npm as one package, [`@adrianeyre/xray`](https://www.npmjs.com/package/@adrianeyre/xray), which users install with:

```bash
pnpm add -g @adrianeyre/xray
xray doctor
```

Its versions are worked out from the repository's commit messages, and published, by [semantic-release](https://semantic-release.gitbook.io), in the `release` job of the [CI workflow](../../.github/workflows/ci.yml), configured in [`release.config.js`](../../release.config.js). This file says what is in the package, how a change reaches it, and what has to be set up by hand, once.

---

## What is published

`packages/xray/` is the package. Every other package in the workspace (`@xray/core`, `@xray/cli`, `@xray/server`, `@xray/web`, `@xray/fixtures`) is private and never published; what the binary needs of them is bundled into it.

Packing it (`pnpm pack`, `pnpm publish`) first runs its `prepack` script, [`build.ts`](../../packages/xray/build.ts), which builds:

| Path in the package | What it is |
| --- | --- |
| `bin/xray.js` | The `xray` binary. |
| `dist/xray.js` | The CLI, with `@xray/core` and `@xray/server`, bundled by esbuild into one module. Only `fastify` and `@fastify/static` are left out, as the package's `dependencies`, installed with it. |
| `engine/` | The engine sidecar, `dotnet publish`ed framework-dependent, so one build runs on every OS (ADR 0001), with the package's version: `xray doctor` names it. |
| `web/` | The web app `xray ui` serves, built by Vite, with its icons. |
| `LICENSE`, `THIRD-PARTY-NOTICES.md`, `README.md` | The licence and notices, copied from the repository's root, and the package's own README, shown on npm. |

Nothing else: the package's `files` lists only these, so no Fixture, test, source file or symbol file is published. Its tests ([`package.test.ts`](../../packages/xray/src/package.test.ts)) hold the tarball to exactly that list. They then install it as a user would, with `pnpm add -g` into a `PNPM_HOME` of their own, and run `xray doctor`, `xray ui` and a Round-trip of the arithmetic Fixture with what was installed. CI runs them on Windows, macOS and Linux with the rest of `pnpm test`; to run them alone:

```bash
pnpm --filter @adrianeyre/xray test
```

To see what would be published, without publishing it:

```bash
pnpm --filter @adrianeyre/xray pack --pack-destination ../..
```

### The downloads

Each GitHub release also carries a download of Xray for each OS and architecture, for people who would rather not install Node.js or pnpm. [`bundle.ts`](../../packages/xray/bundle.ts) writes them from the tarball `pnpm pack` made, as [`bundles.ts`](../../packages/xray/src/bundles.ts) names and lays them out:

| Download | For |
| --- | --- |
| `xray-win-x64.zip`, `xray-win-arm64.zip` | Windows, on x64 and Arm |
| `xray-darwin-arm64.tar.gz`, `xray-darwin-x64.tar.gz` | macOS, on Apple silicon and Intel |
| `xray-linux-x64.tar.gz`, `xray-linux-arm64.tar.gz` | Linux, on x64 and Arm64 |
| `SHA256SUMS.txt` | The SHA-256 of each |

Each unpacks to a folder, `xray-<version>-<platform>/`, holding the package as npm installs it, with its dependencies (`app/`); the Node.js the release job runs on, for that platform, from nodejs.org, checked against its SHA-256, with its licence (`runtime/`); a launcher, `xray` or `xray.cmd`; and a `README.txt` saying how to run it. They still need the .NET SDK, which builds what Xray recovers. Their names carry no version, so `https://github.com/adrianeyre/xray/releases/latest/download/<file>`, which the project site links, always gets the latest.

`bundle.ts` runs the download for the machine it is on before archiving it; once they are attached to the release, the CI workflow downloads the Windows x64, macOS Apple silicon and Linux x64 ones from it, checks each against `SHA256SUMS.txt`, and runs `xray --help` and `xray doctor` with each on its own OS. To write them yourself, from a tarball, with `tar` and `zip` on your `PATH`:

```bash
pnpm --filter @adrianeyre/xray pack --pack-destination ../..
pnpm --filter @adrianeyre/xray bundle ../../adrianeyre-xray-<version>.tgz release
```

The downloads are not code-signed: Windows may warn before running `xray.cmd`, and macOS may ask before running a download opened from a browser. The Node.js inside each is signed by the Node.js project.

---

## Making a change that users will get

Write its commit message as a [Conventional Commit](https://www.conventionalcommits.org): its type says how far the change moves `@adrianeyre/xray`'s version, and its description becomes the line in the release notes and `packages/xray/CHANGELOG.md`.

| Commit | Release |
| --- | --- |
| `fix: …`, `fix(engine): …`, `perf: …` | A patch version: 1.0.0 → 1.0.1 |
| `feat: …` | A minor version: 1.0.0 → 1.1.0 |
| `feat!: …`, or any type with a `BREAKING CHANGE: …` footer | A major version: 1.0.0 → 2.0.0 |
| `docs: …`, `test: …`, `ci: …`, `chore: …`, `refactor: …`, `build: …`, `style: …` | None |

A change that does not reach users, such as to tests, CI or docs, takes a type that releases nothing. What counts is the commit that reaches `main`: with a squash merge, that is the pull request's title, so give it the type.

---

## How a release happens

On every push to `main`, once the checks on every OS pass, the CI workflow's `release` job runs semantic-release, which:

1. Finds the last release, the latest tag `v<version>` on `main`, and reads the commits since. If none of them releases anything, it stops.
2. Works out the next version from them, and checks that npm does not have it already.
3. Writes it to `packages/xray/package.json`, and the release notes to the top of `packages/xray/CHANGELOG.md`.
4. Tests the package at that version, as CI does (`pnpm --filter @adrianeyre/xray test`), then packs it with `pnpm pack`, which builds it, and writes [the downloads](#the-downloads) from what it packed. A failing test stops the release here, before anything is committed, tagged or published.
5. Commits `packages/xray/package.json` and `packages/xray/CHANGELOG.md` to `main` as `chore(release): <version> [skip ci]`, and tags that commit `v<version>`. `[skip ci]` stops the commit starting the workflow again.
6. Publishes the tarball to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers): `npm publish`, with no token, and with provenance.
7. Creates the GitHub release `v<version>`, with the release notes and the downloads attached, and comments on the issues and pull requests it includes.

Then it runs the install instructions, as written, against that version on npm, on Windows, macOS and Linux, with its `verify-install` job (see [The project site](project-site.md#how-the-install-instructions-are-verified)), and runs the downloads, each on its own OS.

Version 1.0.0 is published by hand (see below), so the first version the workflow publishes is the one after it. Until there is a `v*` tag, the release job releases nothing, and says so.

To see what the next release would be, without releasing it, from an up-to-date `main`, with a GitHub token that can push to the repository:

```bash
GITHUB_TOKEN=$(gh auth token) RUNNER_TEMP=$(mktemp -d) pnpm exec semantic-release --dry-run --no-ci
```

---

## Setting up, once

These are done by hand, by an owner of the repository and of the package on npm, in this order. The workflow cannot do them.

1. **Rename the repository** from `temp` to `xray`, in its _Settings → General_, under _Repository name_. `packages/xray/package.json` (`repository`, `homepage`, `bugs`), the README, the package's README, the project site and the docs already name it `xray`; GitHub redirects the old address to the new one.
2. **Publish 1.0.0 by hand, and tag it.** npm lets a trusted publisher be added only to a package that already exists, so the first version cannot be published by the workflow. `packages/xray/package.json` is at `1.0.0`, and `packages/xray/CHANGELOG.md` has its changes. Publish it from `main`:

   ```bash
   git switch main && git pull
   pnpm install --frozen-lockfile
   pnpm --filter @adrianeyre/xray test
   npm login --auth-type=web
   pnpm --filter @adrianeyre/xray publish --access public --no-git-checks
   ```

   Then tag the commit it was published from `v1.0.0`, and create its GitHub release, with its notes from its changelog. semantic-release takes the tag as the last release, and releases only what is merged after it; without it, the workflow would try to release 1.0.0 again, and stops, as npm has it.

   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   awk '/^## /{n++} n==1 && !/^## /' packages/xray/CHANGELOG.md > release-notes.md
   gh release create v1.0.0 --verify-tag --title v1.0.0 --notes-file release-notes.md
   ```

   Then run the CI workflow by hand, from the repository's _Actions_ tab, with _verify-install_ `1.0.0`, to check the install instructions against it on every OS.

3. **Add the trusted publisher.** On npmjs.com, in `@adrianeyre/xray`'s _Settings → Trusted publishing_, add GitHub Actions: owner `adrianeyre`, repository `xray`, workflow `ci.yml`, no environment. Every later version is published by the workflow.
4. **Let the workflow push to `main`.** It commits each release's version and changelog to `main`, and pushes its tag, with the workflow's own `GITHUB_TOKEN`. Should `main` be protected, by a branch protection rule or a ruleset, that needs pull requests or status checks, let GitHub Actions bypass it (in a ruleset's _Bypass list_, add the _GitHub Actions_ app); else the release fails at step 5, having published nothing. Should tags be protected, let it create `v*` tags likewise. No other secret is needed: npm is published to with trusted publishing, and GitHub with `GITHUB_TOKEN`.

Should the repository be renamed again, change the trusted publisher's repository, and the `repository`, `homepage` and `bugs` URLs in `packages/xray/package.json`, to match: npm checks a version's provenance against them.

