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

/**
 * Static HTTP server for the minified A2UI Explorer build.
 * Serves artifacts from `dist/a2ui_explorer/browser` during Playwright
 * E2E testing (`test:closure-compiler`) and local verification (`dev:closure-compiler`).
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist/a2ui_explorer/browser');
const port = 4200;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Creates an HTTP server to serve static assets with Single-Page Application (SPA) routing fallback.
 *
 * If a requested URL path does not map to a static file on disk (such as deep navigation routes
 * like `/catalog` or `/demo`), this handler falls back to serving `index.html`. This allows the
 * client-side Angular Router to initialize and resolve the route natively within the browser.
 */
const server = http.createServer((req, res) => {
  let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html'); // SPA routing fallback
  }
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end(`Server Error: ${err.code}`);
    } else {
      res.writeHead(200, {'Content-Type': contentType});
      res.end(content, 'utf-8');
    }
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[Error] Port ${port} is already in use.`);
    console.error(`Another server instance is already running on http://localhost:${port}.`);
    console.error(`Please terminate the process listening on port ${port} and try again.\n`);
  } else {
    console.error(`\n[Error] Static server error:`, err);
  }
  process.exit(1);
});

server.listen(port, () => {
  console.log(`Static server listening on http://localhost:${port}`);
});

const shutdown = signal => {
  console.log(`\nReceived ${signal}, shutting down server on http://localhost:${port}...`);
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  server.close(() => {
    console.log('Static server closed cleanly.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
