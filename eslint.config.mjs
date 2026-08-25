import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Node process with its own tsconfig — not part of the Next app.
    "server/**",
    // Agent worktrees are throwaway checkouts of this same repo. Without this, an
    // abandoned one makes eslint report every finding twice (once per copy).
    ".claude/worktrees/**",
    // Stray editor/backup copies are not source.
    "**/*.backup",
  ]),
  {
    rules: {
      // `_`-prefixed names mean "deliberately discarded" — most commonly the
      // `const { secret: _secret, ...response } = result` idiom used to strip a
      // server-only field off a tRPC response before returning it.
      // "warn", not "error" — this rule was already at warn level via the Next preset
      // and several unrelated files rely on that. Only the ignore patterns are new.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
