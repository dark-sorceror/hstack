import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const commonRules = {
  "no-empty": ["error", { allowEmptyCatch: true }],
};
export default [
  { ignores: ["main.js", "dist/**", "node_modules/**", ".dev-vault/**", "bin/hstack.cjs"] },
  {
    ...js.configs.recommended,
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node, ...globals.browser } },
    rules: {
      ...js.configs.recommended.rules,
      ...commonRules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "bin/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "bin/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      ...commonRules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];
