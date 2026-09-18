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
import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

/**
 * Entry point of the shared A2UI MCP catalog (`@a2ui/mcp-catalog`).
 *
 * TODO(https://github.com/a2ui-project/a2ui/issues/1698): drop this alias and
 * declare `@a2ui/mcp-catalog` as a normal dependency once the catalog is
 * published to npm. `samples/community/` is a self-contained Yarn root that
 * consumes the published `@a2ui/*` packages rather than the monorepo workspace,
 * so it cannot reference the catalog as `workspace:*`. Until the package ships,
 * resolve it from source here so application code can still import it by its
 * real name.
 */
const a2uiMcpCatalogEntry = fileURLToPath(
  new URL('../../../../../catalogs/mcp/v0_9/src/index.ts', import.meta.url),
);

/**
 * The packages the catalog entry imports, resolved from this sample.
 *
 * That entry lives outside this Yarn root, so Node resolution for its imports
 * walks up from `catalogs/mcp/` and misses `samples/community/node_modules`.
 * Resolving here binds them to the copies this sample installs, which also
 * keeps `@a2ui/web_core` to a single copy in the bundle. `tsconfig.json`
 * carries the same list for the type checker. All of it goes away with the
 * alias above.
 *
 * `import.meta.resolve` applies the `import` condition, so the bundle gets the
 * ESM build of each package rather than the CommonJS one.
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

/**
 * Matches one specifier and nothing beneath it.
 *
 * A string `find` matches by prefix, which would send `zod/v4` to
 * `…/zod/index.js/v4`. Subpaths must keep resolving on their own.
 */
function exactly(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

export default defineConfig({
  resolve: {
    dedupe: ['lit'],
    alias: [
      {find: exactly('@a2ui/mcp-catalog'), replacement: a2uiMcpCatalogEntry},
      ...a2uiMcpCatalogDependencies,
    ],
  },
  build: {
    target: 'esnext',
  },
  server: {
    port: 5173,
  },
  test: {
    // The app is a custom element, so tests need DOM globals.
    environment: 'jsdom',
  },
});
