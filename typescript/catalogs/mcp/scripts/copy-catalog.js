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
 * Copies the canonical MCP catalog schema from the repository's top-level
 * `catalogs/` directory into `src/`, so the published package bundles the
 * exact `catalog.json` it implements (exposed as `@a2ui/catalog-mcp/catalog.json`).
 */
import {copyFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageDir, '..', '..', '..');

copyFileSync(
  join(repoRoot, 'catalogs', 'mcp', 'catalog.json'),
  join(packageDir, 'src', 'catalog.json'),
);
