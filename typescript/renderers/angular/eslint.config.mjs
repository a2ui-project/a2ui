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

import preset from '../../../eslint.preset.mjs';
import {BOUNDARY_ALLOWLIST, BOUNDARY_RESTRICTED} from './eslint.boundary.mjs';

const boundaryPaths = BOUNDARY_RESTRICTED.from.map(name => ({
  name,
  importNames: BOUNDARY_RESTRICTED.names,
  message:
    'Adapter views must read ComponentNode.props instead of importing ComponentContext, GenericBinder, or DataContext.',
}));
const rootSelfImportPath = {
  name: '@a2ui/angular',
  message: 'Use relative imports within root @a2ui/angular instead of self-importing the package.',
};
const v09SelfImportPattern = {
  group: [
    '@a2ui/angular/v0_8',
    '@a2ui/angular/v0_8/*',
    '@a2ui/angular/v0_9',
    '@a2ui/angular/v0_9/*',
    '!@a2ui/angular/v0_9/testing',
  ],
  message:
    'Use relative imports within @a2ui/angular/v0_9 instead of self-importing the entry point.',
};

export default [
  ...preset,
  {
    ignores: ['**/public/a2ui-sandbox/**', '**/src/app/generated/**'],
  },
  {
    files: ['src/core/**/*.ts', 'src/catalog/**/*.ts', 'src/*.ts'],
    ignores: ['**/*.spec.ts', ...BOUNDARY_ALLOWLIST],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [rootSelfImportPath, ...boundaryPaths],
        },
      ],
    },
  },
  {
    files: [
      'src/core/**/*.spec.ts',
      'src/catalog/**/*.spec.ts',
      'src/*.spec.ts',
      ...BOUNDARY_ALLOWLIST.filter(f => !f.startsWith('src/v0_9/')),
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [rootSelfImportPath],
        },
      ],
    },
  },
  {
    files: ['src/v0_8/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@a2ui/angular/v0_8',
              message:
                'Use relative imports within @a2ui/angular/v0_8 instead of self-importing the entry point.',
            },
          ],
          patterns: [
            {
              group: ['@a2ui/angular/v0_8', '@a2ui/angular/v0_8/*'],
              message:
                'Use relative imports within @a2ui/angular/v0_8 instead of self-importing the entry point.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/v0_9/**/*.ts'],
    ignores: ['src/v0_9/testing/**', '**/*.spec.ts', ...BOUNDARY_ALLOWLIST],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: boundaryPaths,
          patterns: [v09SelfImportPattern],
        },
      ],
    },
  },
  {
    files: ['src/v0_9/**/*.spec.ts', ...BOUNDARY_ALLOWLIST.filter(f => f.startsWith('src/v0_9/'))],
    ignores: ['src/v0_9/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [v09SelfImportPattern],
        },
      ],
    },
  },
  {
    files: ['src/v0_9/testing/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@a2ui/angular/testing',
                '@a2ui/angular/testing/*',
                '@a2ui/angular/v0_9/testing',
                '@a2ui/angular/v0_9/testing/*',
              ],
              message:
                'Use relative imports within @a2ui/angular/v0_9/testing instead of self-importing the entry point.',
            },
          ],
        },
      ],
    },
  },
];
