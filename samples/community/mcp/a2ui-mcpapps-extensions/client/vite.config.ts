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

/// <reference types="vitest/config" />
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    dedupe: ['lit'],
    alias: {
      '@a2ui/web_core/v1_0/mcp': path.resolve(
        __dirname,
        '../../../../../renderers/web_core/dist/src/v1_0/mcp/index.js',
      ),
      '@a2ui/web_core/v1_0': path.resolve(
        __dirname,
        '../../../../../renderers/web_core/dist/src/v1_0/index.js',
      ),
      '@a2ui/web_core/v0_9/basic_catalog': path.resolve(
        __dirname,
        '../../../../../renderers/web_core/dist/src/v0_9/basic_catalog/index.js',
      ),
      '@a2ui/web_core/v0_9': path.resolve(
        __dirname,
        '../../../../../renderers/web_core/dist/src/v0_9/index.js',
      ),
      '@a2ui/web_core': path.resolve(
        __dirname,
        '../../../../../renderers/web_core/dist/src/v0_9/index.js',
      ),
    },
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
  },
});
