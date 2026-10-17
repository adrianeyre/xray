#!/usr/bin/env node
// The `xray` binary. There is no build step yet, so the TypeScript sources run
// through tsx, which also maps their `.js` import specifiers to `.ts` files.
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/main.js");
process.exitCode = await main(process.argv.slice(2));
