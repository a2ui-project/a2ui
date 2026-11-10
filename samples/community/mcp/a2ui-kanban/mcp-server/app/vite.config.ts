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

/**
 * Bundles the board app into one self-contained HTML file, `dist/app/board.html`,
 * which the server returns as the `ui://kanban/board` resource.
 */

import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {fileURLToPath} from 'node:url';

const appDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: appDir,
  plugins: [viteSingleFile()],
  build: {
    outDir: fileURLToPath(new URL('../dist/app', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./board.html', import.meta.url)),
    },
  },
});
