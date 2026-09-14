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

export default defineConfig({
  resolve: {
    dedupe: ['lit'],
    alias: {
      '@a2ui/mcp-catalog': a2uiMcpCatalogEntry,
    },
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
