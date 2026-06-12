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
import {resolve} from 'path';
import fs from 'fs';
import {plugin as a2aPlugin} from './middleware/a2a';
import {SANDBOX_BASE_PATH} from './ui/shared-constants.js';

export default defineConfig({
  plugins: [
    a2aPlugin(),
    {
      name: 'serve-sandbox',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith(`/${SANDBOX_BASE_PATH}`)) {
            let urlPath = req.url.slice(1);
            if (
              urlPath.endsWith('.js') &&
              !urlPath.endsWith('app-bridge.js') &&
              !urlPath.endsWith('app-with-deps.js')
            ) {
              urlPath = urlPath.slice(0, -3) + '.ts';
            }
            req.url = '/@fs' + resolve(__dirname, '../../' + urlPath);
            next();
          } else if (req.url?.startsWith('/lit/node_modules/')) {
            const filePath = resolve(__dirname, '../node_modules/' + req.url.slice(18));
            console.log('[Vite Middleware] Serving file directly:', filePath);
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/javascript');
              res.end(fs.readFileSync(filePath));
            } else {
              console.error('[Vite Middleware] File not found:', filePath);
              res.statusCode = 404;
              res.end('Not Found');
            }
          } else {
            next();
          }
        });
      },
    },
  ],
  build: {
    target: 'esnext',
  },
  resolve: {
    dedupe: ['lit'],
    alias: {
      'sandbox.js': '../../shared/mcp_apps_inner_iframe/sandbox.ts',
      '/lit/node_modules': resolve(__dirname, '../node_modules'),
    },
  },
  server: {
    host: '0.0.0.0',
    fs: {
      allow: [
        resolve(__dirname, '.'),
        resolve(__dirname, '../node_modules'),
        resolve(__dirname, '../../shared'),
        resolve(__dirname, '../../../../renderers/lit'),
      ],
    },
  },
});
