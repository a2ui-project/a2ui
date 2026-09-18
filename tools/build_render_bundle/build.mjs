#!/usr/bin/env node
/*
 * Copyright 2024 Google LLC
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

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

const entryFile = path.resolve(__dirname, 'entry.ts');
const assetsDir = path.resolve(projectRoot, 'agent_sdks/python/a2ui_agent/src/a2ui/assets/render');
const renderBundleDir = path.resolve(projectRoot, 'agent_sdks/python/a2ui_agent/src/a2ui/render/bundle');

const bundleJsPath = path.resolve(assetsDir, 'bundle.js');
const harnessHtmlPath = path.resolve(assetsDir, 'harness.html');

console.log('Building A2UI Standalone Render Bundle...');
console.log(`Entry: ${entryFile}`);
console.log(`Output: ${bundleJsPath}`);

fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(renderBundleDir, { recursive: true });

const harnessHtmlContent = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>A2UI Headless Render Harness</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background-color: #ffffff;
      font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    #container {
      display: block;
      padding: 16px;
      min-width: 320px;
      width: 100%;
    }
  </style>
  <script src="./bundle.js"></script>
</head>
<body>
  <div id="container"></div>
  <script>
    window.__A2UI_READY__ = true;
  </script>
</body>
</html>
`;

fs.writeFileSync(harnessHtmlPath, harnessHtmlContent, 'utf-8');
fs.writeFileSync(path.resolve(renderBundleDir, 'harness.html'), harnessHtmlContent, 'utf-8');

const startTime = Date.now();

try {
  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'iife',
    globalName: 'A2UIBundle',
    outfile: bundleJsPath,
    minify: true,
    sourcemap: false,
    target: ['es2022', 'chrome110'],
  });

  const duration = Date.now() - startTime;
  const stats = fs.statSync(bundleJsPath);
  console.log(`Bundle built successfully in ${duration}ms (${(stats.size / 1024).toFixed(1)} KB)`);

  // Also copy bundle.js to render/bundle/ directory
  fs.copyFileSync(bundleJsPath, path.resolve(renderBundleDir, 'bundle.js'));
  console.log(`Copied to ${path.resolve(renderBundleDir, 'bundle.js')}`);
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
