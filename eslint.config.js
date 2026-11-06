import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'tmp/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['tests/**', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
