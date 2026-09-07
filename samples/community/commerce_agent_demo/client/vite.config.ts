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

import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@a2ui/web_core/v0_9/basic_catalog': path.resolve(
        __dirname,
        '../../../../renderers/web_core/dist/src/v0_9/basic_catalog/index.js',
      ),
      '@a2ui/web_core/v0_9': path.resolve(
        __dirname,
        '../../../../renderers/web_core/dist/src/v0_9/index.js',
      ),
      '@a2ui/react/v0_9': path.resolve(
        __dirname,
        '../../../../renderers/react/dist/v0_9/index.js',
      ),
      '@a2ui/web_core': path.resolve(
        __dirname,
        '../../../../renderers/web_core/dist/src',
      ),
      '@a2ui/react': path.resolve(
        __dirname,
        '../../../../renderers/react/dist',
      ),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5180,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
    },
  },
});
