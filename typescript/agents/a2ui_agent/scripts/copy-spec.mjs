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
 * Copies the specification documents the SDK validates against, and web_core does not
 * export, into `src/schemas`. The copies are build outputs and are not checked in.
 */
import {cpSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageDir, '..', '..', '..');

const DOCUMENTS = [['v1_0', 'renderer_to_agent.json']];

for (const [version, file] of DOCUMENTS) {
  const destDir = join(packageDir, 'src', 'schemas', version);
  mkdirSync(destDir, {recursive: true});
  cpSync(join(repoRoot, 'specification', version, 'json', file), join(destDir, file));
}
