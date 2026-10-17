// `pnpm build:fixtures`: builds every Fixture into the cache the tests read,
// so a Fixture that does not compile fails on its own, before any test runs.
import { buildFixture, listFixtures } from "./fixtures.js";

try {
  for (const name of await listFixtures()) {
    const { assemblyPath } = await buildFixture(name);
    console.log(`${name}: ${assemblyPath}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
