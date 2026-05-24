// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      // Next.js generated files
      "apps/web/.next/**",
      "apps/web/next-env.d.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.d.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended"].rules,
      // Off: experiment scripts and generated code use any/unused vars intentionally
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // Off: eslint-disable comments in older files use @ts-ignore
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
];
