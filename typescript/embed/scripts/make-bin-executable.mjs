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
 * Makes the `bin` scripts in `dist/` executable. `tsc` writes them without the execute bit, and
 * workspace installs link the bin without setting it, so running `a2ui-embed` would fail with
 * "Permission denied". npm sets the bit on install from the registry, but not for workspace links.
 */

import {chmod, readFile, stat} from 'node:fs/promises';

const {bin} = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const path of Object.values(bin)) {
  const file = new URL(`../${path}`, import.meta.url);
  const {mode} = await stat(file);
  await chmod(file, mode | 0o111);
}
