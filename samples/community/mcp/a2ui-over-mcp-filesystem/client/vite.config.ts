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

// `vitest/config` re-exports Vite's `defineConfig` widened with the `test` block.
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

/**
 * Target URL for the local MCP proxy server started by `yarn dev`.
 */
const MCP_PROXY_URL = process.env['A2UI_MCP_URL'] ?? 'http://127.0.0.1:8787';

/**
 * Source alias for `@a2ui/catalog-mcp`.
 *
 * TODO(https://github.com/a2ui-project/a2ui/issues/1698): Replace this alias
 * with a standard package dependency once `@a2ui/catalog-mcp` is published to npm.
 */
const a2uiMcpCatalogEntry = fileURLToPath(
  new URL('../../../../../typescript/catalogs/mcp/src/index.ts', import.meta.url),
);

/**
 * Resolves dependencies imported by `@a2ui/catalog-mcp` against this sample's
 * `node_modules` so Vite bundles a single shared copy of each package.
 */
const a2uiMcpCatalogDependencies = [
  '@a2ui/web_core/v0_9',
  '@modelcontextprotocol/sdk/client/index.js',
  '@modelcontextprotocol/sdk/types.js',
  'jmespath',
  're2js',
  'zod',
].map(specifier => ({
  find: exactly(specifier),
  replacement: fileURLToPath(import.meta.resolve(specifier)),
}));

/** Creates an exact-match regular expression for a module specifier so subpath imports are not affected. */
function exactly(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

export default defineConfig({
  resolve: {
    dedupe: ['lit'],
    alias: [
      {find: exactly('@a2ui/catalog-mcp'), replacement: a2uiMcpCatalogEntry},
      ...a2uiMcpCatalogDependencies,
    ],
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {'/mcp': {target: MCP_PROXY_URL, changeOrigin: false}},
    fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]},
  },
  test: {
    environment: 'jsdom',
  },
});
