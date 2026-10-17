// @ts-check
// semantic-release's configuration: how the release job of the CI workflow
// (.github/workflows/ci.yml) versions and publishes @adrianeyre/xray
// from the Conventional Commits merged to main. docs/processes/releasing.md
// says how a release happens, and what has to be set up first.
//
// Only packages/xray is published; the root package and every other package
// in the workspace are private, and bundled into it.
//
// The ${...} in the strings below are lodash templates semantic-release fills
// in (nextRelease.version, ...), not JavaScript's: these are not template
// literals. `npm` is run from $RUNNER_TEMP, outside the repository, as the
// root package.json's devEngines makes npm refuse to run within it.

const preset = "conventionalcommits";
const changelogFile = "packages/xray/CHANGELOG.md";

/** @type {import("semantic-release").Options} */
export default {
  branches: ["main"],
  // Tags are v1.0.0, v1.0.1...: one package is published, so its version
  // alone names a release. Version 1.0.0 is published by hand, from the commit
  // tagged v1.0.0 (docs/processes/releasing.md), and later versions follow on
  // from that tag.
  tagFormat: "v${version}",
  plugins: [
    // feat: is a minor release, fix: and perf: a patch, and a breaking change
    // (feat!: or a BREAKING CHANGE: footer) a major one; any other type, such
    // as docs:, chore:, test: or ci:, releases nothing.
    ["@semantic-release/commit-analyzer", { preset }],
    ["@semantic-release/release-notes-generator", { preset }],
    [
      "@semantic-release/changelog",
      { changelogFile, changelogTitle: "# @adrianeyre/xray" },
    ],
    // Writes the version to packages/xray/package.json, and nothing else: it
    // cannot publish the package, as it runs `npm publish packages/xray` from
    // the repository's root, where devEngines stops npm, and would publish its
    // package.json with the workspace: protocol unresolved.
    ["@semantic-release/npm", { pkgRoot: "packages/xray", npmPublish: false }],
    [
      "@semantic-release/exec",
      {
        // Refuses to release a version npm already has, rather than commit,
        // tag and fail to publish it: version 1.0.0 should it not be tagged.
        verifyReleaseCmd:
          'cd "$RUNNER_TEMP" && if [ -n "$(npm view @adrianeyre/xray@${nextRelease.version} version 2>/dev/null)" ]; then echo "@adrianeyre/xray@${nextRelease.version} is on npm already: tag the commit it was published from v${nextRelease.version} (docs/processes/releasing.md)." >&2; exit 1; fi',
        // Tests the new version as users install it (packed, then installed
        // with `pnpm add -g`, then xray doctor, xray ui and a Round-trip), then
        // packs it, which builds it through its prepack script; pnpm resolves
        // the workspace: protocol in what it packs.
        //
        // Then writes, from that tarball, the downloads the GitHub release
        // carries: for each OS and architecture, the package with a Node.js of
        // its own, so it runs without Node.js or pnpm installed, and their
        // SHA-256s (packages/xray/bundle.ts).
        prepareCmd:
          'pnpm --filter @adrianeyre/xray test && pnpm --filter @adrianeyre/xray pack --pack-destination "$RUNNER_TEMP/xray-release" && pnpm --filter @adrianeyre/xray bundle "$RUNNER_TEMP/xray-release/adrianeyre-xray-${nextRelease.version}.tgz" "$PWD/packages/xray/release"',
        // Publishes that tarball with npm trusted publishing: npm exchanges the
        // workflow's OIDC token for one that can publish, so no npm token is
        // stored anywhere, and gives the version provenance.
        publishCmd:
          'cd "$RUNNER_TEMP" && npm publish "$RUNNER_TEMP/xray-release/adrianeyre-xray-${nextRelease.version}.tgz" --access public --provenance',
        // Tells the CI workflow which version to verify the install of.
        successCmd: 'echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"',
      },
    ],
    // Commits the version and the changelog to main, with [skip ci], as
    // nothing else changes; semantic-release then tags that commit.
    [
      "@semantic-release/git",
      {
        assets: ["packages/xray/package.json", changelogFile],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    // The GitHub release, with the same notes as the changelog, carrying the
    // downloads for Windows, macOS and Linux, and their SHA-256s.
    [
      "@semantic-release/github",
      {
        assets: [
          { path: "packages/xray/release/*.zip" },
          { path: "packages/xray/release/*.tar.gz" },
          {
            path: "packages/xray/release/SHA256SUMS.txt",
            label: "SHA256SUMS.txt: the SHA-256 of each download",
          },
        ],
      },
    ],
  ],
};
