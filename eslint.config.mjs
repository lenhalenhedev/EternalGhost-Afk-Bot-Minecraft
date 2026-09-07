import js from '@eslint/js';
import globals from 'globals';
import json from '@eslint/json';
import { defineConfig } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig([
  {
    ignores: [
      'package-lock.json',
      'web/package-lock.json',
      'web/node_modules/**',
      'web/dist/**',
      'logs/**',
      'data/**',
      // Generated/external artifacts that are not JS source: the read-only
      // security audit report and the machine-generated remediation results.
      'report/**',
      'docs/security-fix-*',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    files: ['web/src/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },

  {
    files: ['**/*.json'],
    plugins: { json },
    language: 'json/json',
    extends: ['json/recommended'],
  },

  eslintPluginPrettierRecommended,
]);
