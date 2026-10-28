import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  ...compat.config({ extends: ['next/core-web-vitals', 'next/typescript'] }),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.json' },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Down-tune Next 15 / React 19 strict-new rules to keep lint actionable.
      // These are stylistic refinements, not the baseline guard the brief specifies.
      // Re-evaluate in Wave 3 once Task 2 (mysql2) and Task 3 (dead code) are caught up.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'react/no-unescaped-entities': 'off',
      'import/no-anonymous-default-export': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      '@next/next/no-img-element': 'off',
      '@next/next/no-css-tags': 'off',
      '@next/next/no-html-link-for-pages': 'off',
      // Brief-specified rules
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
      // mysql2 .execute() uses the binary protocol and corrupts 4-byte UTF-8 (supp-plane) chars;
      // .query() uses text protocol and preserves them. See mysql2-supp-plane-bug memory.
      // Mechanical Wave 1 Task 2 migration removed all .execute() sites; forbid new ones.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.property.name='pool'][property.name='execute']",
          message:
            "Use pool.query() instead of pool.execute() — see mysql2-supp-plane-bug memory. The binary protocol corrupts 4-byte UTF-8 (supp-plane) chars.",
        },
        {
          selector: "CallExpression[callee.property.name='execute']",
          message:
            'Use .query() instead of .execute() for mysql2 — text protocol preserves supp-plane chars (U+10000+).',
        },
      ],
    },
  },
  {
    // CLI scripts are their own interface: what they print IS their product.
    // The allow-list above (warn/error/info/debug) is written for app code,
    // where a stray console.log bypasses the logger and leaks into request
    // logs. A one-shot CLI script has no logger and no request — `console.log`
    // is the correct call, and swapping 190+ sites to console.info would be
    // churn without a behavioural gain (both go to stdout in Node).
    files: ['scripts/**/*.{ts,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Config files (.mjs) are not covered by the `**/*.{ts,tsx}` block above,
    // so they still inherit `import/no-anonymous-default-export` from
    // next/core-web-vitals. An anonymous default export is the idiomatic
    // shape for a flat config — PostCSS and ESLint both expect it.
    files: ['**/*.mjs'],
    rules: {
      'import/no-anonymous-default-export': 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'Up/**',
      'scripts/build-*/**',
      'scripts/audit/**',
      'tests/fixtures/**',
      'public/**',
      'data/**',
      'docs/**',
      // Git-ignored scratch directories. ESLint's flat config does not read
      // .gitignore, so a scratch file dropped here would be linted — and
      // `parserOptions.project` fails on it, because TypeScript's include
      // globs skip dot-directories, so the file belongs to no project.
      '.superpowers/**',
      '.tmp/**',
    ],
  },
];
