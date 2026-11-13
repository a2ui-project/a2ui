/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import gts from 'gts';

/**
 * Shared ESLint preset across all A2UI monorepo packages.
 */
export default [
  ...gts,
  {
    rules: {
      // Decouple formatting from linting (rely strictly on Prettier for formatting)
      'prettier/prettier': 'off',
      // Common monorepo rule relaxations
      eqeqeq: ['error', 'always', {null: 'ignore'}],
      'no-undef': 'off',
      quotes: ['warn', 'single', {avoidEscape: true, allowTemplateLiterals: true}],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    ignores: ['**/v0_8/**', '**/0.8/**', '**/v0_9/schema/index.ts', '**/v1_0/schema/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration[exported=null]',
          message:
            'Avoid wildcard barrel exports (`export *`). Use explicit named exports (`export { ... }`) or namespace exports (`export * as ...`).',
        },
      ],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/lib/**',
      '**/node_modules/**',
      '**/.angular/**',
      '.wireit/**',
      '**/*.d.ts',
      '**/generated/**',
      '**/generated.ts',
    ],
  },
];
