import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Where the project lives, taken from @adrianeyre/xray's package.json, the one
// place docs/processes/releasing.md says to change when the repository is
// renamed: the site's links, and its own address, follow it.

/** The repository's root folder. */
export const REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
);

const manifest = JSON.parse(
  readFileSync(new URL("../../xray/package.json", import.meta.url), "utf8"),
) as {
  readonly name: string;
  readonly repository: { readonly url: string };
};

const repository = /^git\+https:\/\/github\.com\/([^/]+)\/([^/]+?)\.git$/.exec(
  manifest.repository.url,
);
if (repository === null) {
  throw new Error(
    `@adrianeyre/xray's repository, ${manifest.repository.url}, is not a GitHub repository's git+https URL.`,
  );
}
const [, owner = "", name = ""] = repository;

/** The package users install. */
export const PACKAGE_NAME = manifest.name;

/** The repository on GitHub. */
export const REPOSITORY_URL = `https://github.com/${owner}/${name}`;

/** The site's own domain, which its `CNAME` gives GitHub Pages. */
export const SITE_DOMAIN = "xray.adrianeyre.co.uk";

/** Where GitHub Pages publishes the site: at its own domain. */
export const SITE_URL = `https://${SITE_DOMAIN}/`;

/** The page of the package on npm. */
export const NPM_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;

/** The address of `path`, a file in the repository, on GitHub, as it is on `main`. */
export function repositoryFileUrl(path: string): string {
  return `${REPOSITORY_URL}/blob/main/${path}`;
}
