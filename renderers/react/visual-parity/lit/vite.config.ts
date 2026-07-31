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

export default defineConfig({
  root: 'lit',
  server: {
    port: 5002,
    strictPort: true,
  },
  optimizeDeps: {
    // Always re-optimize on startup so rebuilds of file: deps don't cause 504s
    force: true,
    // Don't pre-bundle @a2ui/lit or its deps to avoid duplicate module instances
    exclude: [
      '@a2ui/lit',
      'markdown-it',
      'clsx',
      'signal-utils/array',
      'signal-utils/map',
      'signal-utils/object',
      'signal-utils/set',
    ],
  },
  esbuild: {
    // Enable decorator support
    target: 'es2022',
  },
});
