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
 * Copies `typescript/catalogs/shared/` (the sandbox proxy and the host-side helpers every catalog
 * package compiles in) to `src/shared/`, replacing any previous copy so deleted files do not
 * linger. The copy is git-ignored; edit the files under `typescript/catalogs/shared/`.
 */
import {cpSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharedDir = join(packageDir, '..', 'shared');
const targetDir = join(packageDir, 'src', 'shared');

rmSync(targetDir, {recursive: true, force: true});
cpSync(sharedDir, targetDir, {recursive: true});
