/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

// The two verification pages double as the build targets: bundling them proves
// the components still compile and link against the published @a2ui/* packages.
export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'dist/demo',
    rollupOptions: {
      input: {
        'override-test': fileURLToPath(new URL('./test/override-test.html', import.meta.url)),
        'org-chart-test': fileURLToPath(new URL('./test/org-chart-test.html', import.meta.url)),
      },
    },
  },
  resolve: {
    dedupe: ['lit'],
  },
  server: {
    host: '0.0.0.0',
  },
});
