/*
 * Copyright 2026 Google LLC
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

import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

/**
 * Monorepo builds of the `@a2ui/*` packages.
 *
 * TODO(https://github.com/a2ui-project/a2ui/issues/1698): use published
 * packages once they include v1.0 multi-catalog surfaces. `samples/community/`
 * is its own Yarn root, so it cannot depend on the workspace packages; these
 * aliases point at their `dist/` instead (build them from the repository root
 * first, see README.md). The React and web_core builds then share one copy of
 * every module.
 */
const monorepoAliases = Object.entries({
  '@a2ui/markdown-it': 'typescript/renderers/markdown-it/dist/src/markdown.js',
  '@a2ui/react': 'typescript/renderers/react/dist/index.js',
  '@a2ui/web_core': 'typescript/core/web_core/dist/src/index.js',
  '@a2ui/web_core/catalogs/basic/v1':
    'typescript/core/web_core/dist/src/catalogs/basic/v1/index.js',
  '@a2ui/web_core/v1_0': 'typescript/core/web_core/dist/src/v1_0/index.js',
}).map(([specifier, path]) => ({
  find: exactly(specifier),
  replacement: fileURLToPath(new URL(`../../../../${path}`, import.meta.url)),
}));

/** Matches one specifier and nothing beneath it. */
function exactly(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

const apiTarget = `http://localhost:${process.env.LINER_NOTES_API_PORT ?? '8100'}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: monorepoAliases,
    // The aliased monorepo builds would otherwise resolve their own copies.
    dedupe: ['react', 'react-dom', 'zod'],
  },
  server: {
    port: Number(process.env.LINER_NOTES_WEB_PORT ?? 5180),
    strictPort: true,
    proxy: {'/api': apiTarget},
    fs: {
      allow: [fileURLToPath(new URL('../../../../', import.meta.url))],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
