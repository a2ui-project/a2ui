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
 * Copies the shared double-iframe sandbox (typescript/catalogs/shared in the A2UI monorepo) into
 * src/shared, the way @a2ui/catalog-mcp does, and the ReactApp catalog into src/catalog.json.
 * Both copies are build outputs and are not committed.
 */
import {cpSync, existsSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharedSource = join(
  packageDir,
  '..',
  '..',
  '..',
  '..',
  '..',
  'typescript',
  'catalogs',
  'shared',
);
const catalogSource = join(packageDir, '..', '..', 'catalog', 'v1', 'catalog.json');

if (!existsSync(sharedSource)) {
  throw new Error(`Shared sandbox not found at ${sharedSource}.`);
}
rmSync(join(packageDir, 'src', 'shared'), {recursive: true, force: true});
cpSync(sharedSource, join(packageDir, 'src', 'shared'), {recursive: true});
cpSync(catalogSource, join(packageDir, 'src', 'catalog.json'));
