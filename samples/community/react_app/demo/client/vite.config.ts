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
 * Vite config of the demo client. Besides the app, the dev server serves:
 * - the sandbox proxy pages of @a2ui-labs/react-app at /a2ui-sandbox/,
 * - the ReactApp runtime at /a2ui-sandbox/react-app/v1/ (with the CORS headers app frames need),
 * - the agent at /api, proxied to DEMO_AGENT_URL (default http://127.0.0.1:8787).
 * It listens on DEMO_CLIENT_HOST:DEMO_CLIENT_PORT (default 127.0.0.1:5317).
 */
import {createReadStream, readFileSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {createReactAppRuntimeHandler} from '@a2ui-labs/react-app-runtime';
import {defineConfig, type Connect, type Plugin} from 'vite';

const require = createRequire(import.meta.url);
const clientDir = dirname(fileURLToPath(import.meta.url));
const sandboxDir = join(dirname(require.resolve('@a2ui-labs/react-app')), 'sandbox');
const agentUrl = process.env['DEMO_AGENT_URL'] ?? 'http://127.0.0.1:8787';
const host = process.env['DEMO_CLIENT_HOST'] ?? '127.0.0.1';
const port = Number(process.env['DEMO_CLIENT_PORT'] ?? 5317);
/**
 * Host headers the server accepts besides localhost: DEMO_ALLOWED_HOSTS (comma-separated), or any
 * host when the server listens beyond loopback, so the page opens by machine name.
 */
const allowedHosts: true | string[] = process.env['DEMO_ALLOWED_HOSTS']
  ? process.env['DEMO_ALLOWED_HOSTS'].split(',').map(name => name.trim())
  : ['127.0.0.1', 'localhost', '::1'].includes(host)
    ? []
    : true;
const serverOptions = {
  host,
  port,
  strictPort: true,
  allowedHosts,
  proxy: {'/api': {target: agentUrl, changeOrigin: true}},
};

const SANDBOX_BASE = '/a2ui-sandbox/';
const RUNTIME_BASE = '/a2ui-sandbox/react-app/v1/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/** Serves the sandbox proxy pages and the ReactApp runtime from the dev and preview servers. */
function reactAppAssets(): Plugin {
  const runtime = createReactAppRuntimeHandler({basePath: RUNTIME_BASE});
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith(RUNTIME_BASE)) {
      runtime(req, res, next);
      return;
    }
    if (!pathname.startsWith(SANDBOX_BASE)) {
      next();
      return;
    }
    const file = resolve(sandboxDir, normalize(pathname.slice(SANDBOX_BASE.length)));
    try {
      if (!file.startsWith(sandboxDir + sep) || !statSync(file).isFile()) {
        throw new Error('not a sandbox file');
      }
    } catch {
      next();
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'a2ui-react-app-assets',
    configureServer: server => {
      server.middlewares.use(middleware);
    },
    configurePreviewServer: server => {
      server.middlewares.use(middleware);
    },
  };
}

/** The single copy of a package this client resolves, so the portal-linked renderer shares it. */
function single(name: string): string {
  let dir = dirname(require.resolve(name));
  while (!isPackageRoot(dir, name)) {
    dir = dirname(dir);
  }
  return dir;
}

function isPackageRoot(dir: string, name: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === name;
  } catch {
    return false;
  }
}

export default defineConfig({
  root: clientDir,
  plugins: [react(), reactAppAssets()],
  resolve: {
    alias: {react: single('react'), 'react-dom': single('react-dom'), lit: single('lit')},
    dedupe: ['react', 'react-dom', 'lit', '@a2ui/web_core'],
  },
  server: serverOptions,
  preview: serverOptions,
});
