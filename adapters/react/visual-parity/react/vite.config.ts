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
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'react',
  server: {
    port: 5001,
    strictPort: true,
  },
  optimizeDeps: {
    // Always re-optimize on startup so rebuilds of file: deps don't cause 504s
    force: true,
    // Pre-bundle web_core subpath imports so Vite doesn't discover them lazily
    // (which causes "optimized dependencies changed. reloading" mid-page-load)
    include: ['@a2ui/web_core/styles/index', '@a2ui/web_core/data/model-processor'],
    exclude: [
      '@a2ui/react',
      '@a2ui/lit',
      'markdown-it',
      'clsx',
      'signal-utils/array',
      'signal-utils/map',
      'signal-utils/object',
      'signal-utils/set',
    ],
  },
  resolve: {
    alias: {
      // Dedupe React to avoid "Invalid hook call" errors with linked packages
      react: path.resolve(__dirname, '../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
    },
  },
});
