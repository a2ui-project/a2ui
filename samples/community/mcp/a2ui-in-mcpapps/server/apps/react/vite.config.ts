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
import {viteSingleFile} from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    // A single instance of the A2UI data-model/signals stack is required:
    // duplicated copies (e.g. hoisted vs nested in node_modules) break
    // reactivity between the MessageProcessor and the rendered components.
    dedupe: [
      '@a2ui/web_core',
      '@a2ui/markdown-it',
      '@preact/signals-core',
      'react',
      'react-dom',
      'zod',
    ],
  },
  build: {
    outDir: '../public',
    // public/ is shared with the other micro-apps (app.html, editor.html).
    emptyOutDir: false,
    rollupOptions: {
      input: 'react.html',
    },
  },
});
