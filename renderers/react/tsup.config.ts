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

import {defineConfig} from 'tsup';

export default defineConfig([
  // Main entry with DTS
  {
    entry: {
      index: 'src/index.ts',
      'v0_8/index': 'src/v0_8/index.ts',
      'v0_9/index': 'src/v0_9/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['react', 'react-dom', 'markdown-it'],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
  },
  // Styles entry without DTS (avoids symlink resolution issues)
  {
    entry: {
      'styles/index': 'src/styles/index.ts',
      'v0_8/styles/index': 'src/v0_8/styles/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    treeshake: true,
    external: ['@a2ui/lit'],
  },
]);
