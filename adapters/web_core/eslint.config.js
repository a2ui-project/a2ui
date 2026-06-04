/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import gts from 'gts';

const customConfig = [
  {
    ignores: [
      '.prettierrc.js',
      'eslint.config.js',
      'dist',
      'node_modules',
      '.wireit',
      '**/*.d.ts',
      // Old library version.
      'src/v0_8',
    ],
  },
  {
    rules: {
      // any is often the best we can do for a generic library.
      '@typescript-eslint/no-explicit-any': 'off',
      // Also needed for generic library functionality, though perhaps we could
      // make these more precise in the future.
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // Not a terribly useful check at time of writing - perhaps enable later.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
];

export default [...gts, ...customConfig];
