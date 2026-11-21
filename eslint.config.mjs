import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["main.js", "dist/**", "node_modules/**", ".dev-vault/**"] },
  {
    ...js.configs.recommended,
    files: ["src/**/*.js", "src/**/*.cjs", "bin/**/*.cjs", "scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.browser, HSTACK_SQL_WORKER: "readonly" },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
