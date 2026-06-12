/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {config} from 'dotenv';
import {UserConfig} from 'vite';
import * as Middleware from './middleware';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SANDBOX_ENTRY_NAME, SANDBOX_BASE_PATH, SANDBOX_IFRAME_PATH} from './ui/shared-constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async () => {
  config();

  const entry: Record<string, string> = {
    contact: resolve(__dirname, 'index.html'),
    [SANDBOX_ENTRY_NAME]: resolve(__dirname, `../..${SANDBOX_IFRAME_PATH}`),
  };

  return {
    plugins: [
      Middleware.A2AMiddleware.plugin(),
      {
        name: 'serve-sandbox',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url?.startsWith(`/${SANDBOX_BASE_PATH}`)) {
              let targetPath = req.url.slice(1);
              // Normalize .js requests from HTML back to source .ts files for Vite bundling
              if (targetPath.endsWith('.js')) {
                targetPath = targetPath.slice(0, -3) + '.ts';
              }
              req.url = '/@fs' + resolve(__dirname, '../../' + targetPath);
            }
            next();
          });
        },
      },
    ],
    build: {
      rollupOptions: {
        input: entry,
      },
      target: 'es2021',
    },
    define: {},
    resolve: {
      dedupe: ['lit'],
      alias: {
        '@a2ui/markdown-it': resolve(
          __dirname,
          '../../../../renderers/markdown/markdown-it/dist/src/markdown.js',
        ),
        'sandbox.js': resolve(__dirname, '../../' + SANDBOX_ENTRY_NAME + '.ts'),
        '@modelcontextprotocol/ext-apps/app-bridge': resolve(
          __dirname,
          '../node_modules/@modelcontextprotocol/ext-apps/dist/src/app-bridge.js',
        ),
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'es2021',
      },
    },
    server: {
      host: true, // Listen on all network interfaces (0.0.0.0), enabling both localhost and 127.0.0.1 simultaneously
      fs: {
        allow: ['../../', './'],
      },
    },
  } satisfies UserConfig;
};
