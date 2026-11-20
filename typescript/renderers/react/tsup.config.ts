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
    esbuildOptions(options, {format}) {
      options.jsx = 'transform';
      options.jsxFactory = '__a2uiCreateElement';
      options.jsxFragment = '__a2uiFragment';
      delete options.tsconfig;
      options.tsconfigRaw = {
        compilerOptions: {
          jsx: 'react',
          jsxFactory: '__a2uiCreateElement',
          jsxFragmentFactory: '__a2uiFragment',
        },
      };
      options.banner = {
        js:
          format === 'esm'
            ? "import {createElement as __a2uiCreateElement, Fragment as __a2uiFragment} from 'react';"
            : "const {createElement: __a2uiCreateElement, Fragment: __a2uiFragment} = require('react');",
      };
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
  },
]);
