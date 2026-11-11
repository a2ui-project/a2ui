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
 * Servers of the fixture test, on two origins:
 *
 * 1. The host page (HOST_PORT): the fixture, its bundle and the sandbox proxy at /a2ui-sandbox/.
 * 2. The runtime (RUNTIME_PORT): @a2ui-labs/react-app-runtime at /react-app/v1/, on another origin
 *    so the test proves the CORS headers that opaque-origin app frames need.
 */
import {createReadStream, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReactAppRuntimeHandler} from '@a2ui-labs/react-app-runtime';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(e2eDir, '..');
const HOST_PORT = Number(process.env.HOST_PORT ?? 47317);
const RUNTIME_PORT = Number(process.env.RUNTIME_PORT ?? 47318);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Serves `file` if it exists under `root`, else 404. */
function serveFile(res, root, relativePath) {
  const file = resolve(root, normalize(relativePath));
  if (!file.startsWith(resolve(root) + sep)) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) {
      throw new Error('not a file');
    }
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream'});
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const {pathname} = new URL(req.url ?? '/', 'http://localhost');
  if (pathname === '/' || pathname === '/index.html') {
    serveFile(res, join(e2eDir, 'fixture'), 'index.html');
  } else if (pathname.startsWith('/.generated/')) {
    serveFile(res, join(e2eDir, '.generated'), pathname.slice('/.generated/'.length));
  } else if (pathname.startsWith('/a2ui-sandbox/')) {
    serveFile(res, join(packageDir, 'dist', 'sandbox'), pathname.slice('/a2ui-sandbox/'.length));
  } else {
    res.writeHead(404).end();
  }
}).listen(HOST_PORT, '127.0.0.1', () => {
  console.log(`Fixture host on http://127.0.0.1:${HOST_PORT}`);
});

const runtimeHandler = createReactAppRuntimeHandler({basePath: '/react-app/v1/'});
createServer((req, res) => runtimeHandler(req, res)).listen(RUNTIME_PORT, '127.0.0.1', () => {
  console.log(`Runtime on http://127.0.0.1:${RUNTIME_PORT}/react-app/v1/`);
});
