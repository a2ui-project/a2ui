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

import preset from '../../eslint.preset.mjs';

export default [
  ...preset,
  {
    files: ['src/v0_8/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@a2ui/angular',
              message:
                'Use relative imports within @a2ui/angular/v0_8 instead of self-importing the package.',
            },
            {
              name: '@a2ui/angular/v0_8',
              message:
                'Use relative imports within @a2ui/angular/v0_8 instead of self-importing the package.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/v0_9/**/*.ts'],
    ignores: ['src/v0_9/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@a2ui/angular',
              message:
                'Use relative imports within @a2ui/angular/v0_9 instead of self-importing the package.',
            },
            {
              name: '@a2ui/angular/v0_9',
              message:
                'Use relative imports within @a2ui/angular/v0_9 instead of self-importing the package.',
            },
            {
              name: '@a2ui/angular/v0_8',
              message: 'Do not import @a2ui/angular/v0_8 from @a2ui/angular/v0_9.',
            },
          ],
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
          paths: [
            {
              name: '@a2ui/angular',
              message:
                'Use relative imports within @a2ui/angular/v0_9/testing instead of self-importing the package.',
            },
            {
              name: '@a2ui/angular/testing',
              message:
                'Use relative imports within @a2ui/angular/v0_9/testing instead of self-importing the package.',
            },
            {
              name: '@a2ui/angular/v0_9/testing',
              message:
                'Use relative imports within @a2ui/angular/v0_9/testing instead of self-importing the package.',
            },
          ],
        },
      ],
    },
  },
];
