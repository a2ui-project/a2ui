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

import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

import {resolve} from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow serving files from the root of the repo (where specifications are)
      allow: ['../../../../'],
    },
  },
  resolve: {
    alias: {
      '@a2ui/react/v0_9': resolve(__dirname, '../src/v0_9/index.ts'),
      '@a2ui/react/v0_8': resolve(__dirname, '../src/v0_8/index.ts'),
      '@a2ui/react/styles': resolve(__dirname, '../src/styles/index.ts'),
      '@a2ui/react': resolve(__dirname, '../src/index.ts'),
      '@a2ui/markdown-it': resolve(__dirname, '../../markdown/markdown-it/dist/src/markdown.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
} as any);
