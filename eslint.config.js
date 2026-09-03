const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const angular = require('angular-eslint');

// angular-eslint 22 publishes its recommended rule sets as flat-config arrays
// on the meta package; the plugins themselves no longer carry `configs`.
const rulesOf = (configs) => Object.assign({}, ...configs.map((config) => config.rules ?? {}));

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
      '@angular-eslint': angular.tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...rulesOf(angular.configs.tsRecommended),
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
      // Angular 22 defaults to OnPush; the migration pinned existing components to Eager
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error'
    }
  },
  {
    files: ['src/**/*.html'],
    languageOptions: {
      parser: angular.templateParser
    },
    plugins: {
      '@angular-eslint/template': angular.templatePlugin
    },
    rules: {
      ...rulesOf(angular.configs.templateRecommended),
      '@angular-eslint/template/eqeqeq': 'off',
      '@angular-eslint/template/prefer-control-flow': 'off'
    }
  }
];
