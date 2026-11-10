/*
 * Copyright 2026 Google LLC
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

import preset from '../../eslint.preset.mjs';

export default [
  ...preset,
  {
    // The copied shared sandbox is linted where it lives (typescript/catalogs/shared).
    ignores: [
      'dist/**',
      'src/shared/**',
      'e2e/.generated/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['e2e/**/*.ts', 'e2e/**/*.tsx', 'playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./e2e/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs'],
    languageOptions: {
      globals: {console: 'readonly', process: 'readonly'},
    },
  },
];
