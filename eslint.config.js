// @ts-check
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/dist/",
    "**/coverage/",
    // What @adrianeyre/xray publishes, built when it is packed.
    "packages/xray/engine/",
    "packages/xray/web/",
  ]),
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["packages/web/**", "packages/site/static/**"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  prettier,
);
