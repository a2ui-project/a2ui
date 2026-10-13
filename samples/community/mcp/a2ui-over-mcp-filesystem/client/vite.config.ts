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
 * Monorepo builds of the `@a2ui/*` packages this sample imports.
 *
 * TODO(https://github.com/a2ui-project/a2ui/issues/1698): drop these aliases
 * and declare `@a2ui/catalog-mcp` as a normal dependency once it is published
 * to npm. `samples/community/` is a self-contained Yarn root that consumes the
 * published `@a2ui/*` packages rather than the monorepo workspace, so it
 * cannot reference the catalog as `workspace:*`. Until the package ships, it
 * resolves to the monorepo `dist/` (built by `yarn workspace @a2ui/catalog-mcp
 * run build` at the repository root), and so do `@a2ui/lit` and
 * `@a2ui/web_core`, which the catalog imports from there, so the bundle holds
 * one copy of `@a2ui/web_core`.
 */
const monorepoAliases = Object.entries({
  '@a2ui/catalog-mcp': 'typescript/catalogs/mcp/dist/index.js',
  '@a2ui/lit/v0_9': 'renderers/lit/dist/src/v0_9/index.js',
  '@a2ui/web_core/v0_9': 'typescript/web_core/dist/src/v0_9/index.js',
}).map(([specifier, path]) => ({
  find: exactly(specifier),
  replacement: fileURLToPath(new URL(`../../../../../${path}`, import.meta.url)),
}));

/** Creates an exact-match regular expression for a module specifier so subpath imports are not affected. */
function exactly(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

export default defineConfig({
  resolve: {
    dedupe: ['lit', '@lit/context', '@lit-labs/signals'],
    alias: monorepoAliases,
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {'/mcp': {target: MCP_PROXY_URL, changeOrigin: false}},
    fs: {allow: [fileURLToPath(new URL('../../../../..', import.meta.url))]},
  },
  test: {
    environment: 'jsdom',
  },
});
