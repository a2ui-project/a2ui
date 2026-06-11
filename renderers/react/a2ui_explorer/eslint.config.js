import parentConfig from '../eslint.config.js';

export default [
  ...parentConfig,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.spec.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['src/generated/**', 'dist/**', 'node_modules/**'],
  },
];
