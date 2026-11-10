import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "coverage/**", "server", "deploy/**/*.rendered.json"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Same rule choices as virgo-api's eslint.config.js.
    rules: {
      "no-undef": "off",
      "no-case-declarations": "off",
      "no-empty": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
