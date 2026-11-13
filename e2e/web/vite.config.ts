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

import {fileURLToPath} from 'node:url';

import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

/** Builds the two shells as one static site: `/lit.html` and `/react.html`. */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        lit: fileURLToPath(new URL('./lit.html', import.meta.url)),
        react: fileURLToPath(new URL('./react.html', import.meta.url)),
      },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
