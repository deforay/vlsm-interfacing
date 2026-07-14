const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const angularPlugin = require('@angular-eslint/eslint-plugin');
const templateParser = require('@angular-eslint/template-parser');
const templatePlugin = require('@angular-eslint/eslint-plugin-template');

module.exports = [
  {
    ignores: ['app/**/*.js', 'dist/**', 'release/**', 'node_modules/**', 'out-tsc/**']
  },
  {
    files: ['src/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      '@angular-eslint': angularPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...angularPlugin.configs.recommended.rules,
      // The existing application relies heavily on dynamic Electron and socket
      // objects. Tighten these incrementally as their service boundaries mature.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@angular-eslint/directive-class-suffix': 'off',
      '@angular-eslint/prefer-inject': 'off',
      '@angular-eslint/prefer-standalone': 'off',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error'
    }
  },
  {
    files: ['src/**/*.html'],
    languageOptions: {
      parser: templateParser
    },
    plugins: {
      '@angular-eslint/template': templatePlugin
    },
    rules: {
      ...templatePlugin.configs.recommended.rules,
      '@angular-eslint/template/eqeqeq': 'off',
      '@angular-eslint/template/prefer-control-flow': 'off'
    }
  }
];
