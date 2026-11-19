// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    // dkit runs on Node: `process`, `console`, `Buffer` etc. are real globals.
    languageOptions: { globals: globals.node },
    rules: {
      // Allow `r.ok ? log.ok(x) : log.error(y)` for logging.
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true }],
    },
  },
);
