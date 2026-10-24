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

/**
 * Vitest configuration for `a2ui_filesystem.test.ts`, the surface test that
 * drives `a2ui_filesystem.json` through `@a2ui/testing` and
 * `@a2ui/catalog-mcp/testing`.
 *
 * This config is separate from `client/vite.config.ts` because the surface
 * test runs the in-repo `@a2ui/web_core` sources, which the harness is built
 * against, while the client tests run the published `@a2ui/lit` and its
 * matching published `@a2ui/web_core`.
 *
 * TODO(https://github.com/a2ui-project/a2ui/issues/1698): Replace these
 * aliases with standard package dependencies once `@a2ui/testing`,
 * `@a2ui/catalog-mcp`, and a matching `@a2ui/web_core` are published to npm.
 */

import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

/** Resolves a path inside the monorepo, five levels up from this sample. */
const inRepo = (relative: string) =>
  fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));

/** Creates an exact-match regular expression for a module specifier. */
function exactly(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

export default defineConfig({
  resolve: {
    alias: [
      {find: exactly('@a2ui/testing'), replacement: inRepo('typescript/testing/src/index.ts')},
      {
        find: exactly('@a2ui/catalog-mcp/testing'),
        replacement: inRepo('typescript/catalogs/mcp/src/testing/index.ts'),
      },
      {
        find: exactly('@a2ui/catalog-mcp'),
        replacement: inRepo('typescript/catalogs/mcp/src/index.ts'),
      },
      {
        find: exactly('@a2ui/web_core/v0_9'),
        replacement: inRepo('typescript/core/web_core/src/v0_9/index.ts'),
      },
    ],
  },
  test: {
    include: ['a2ui_filesystem.test.ts'],
  },
});
