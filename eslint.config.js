import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "bin/**",
      "**/node_modules/**",
      "**/.generated/**",
      "src/**",
      "docs/**",
      "examples/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
);
