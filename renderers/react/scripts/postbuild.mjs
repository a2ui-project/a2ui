/*
 * Copyright 2026 Google LLC
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

import {copyFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const src = join(root, 'src');

if (!existsSync(dist)) {
  mkdirSync(dist, {recursive: true});
}

// Function to copy a file to both .d.ts and .d.cts
function copyDts(source, destinationDir) {
  const dts = source;
  const targetDts = join(destinationDir, 'index.d.ts');
  const targetDcts = join(destinationDir, 'index.d.cts');

  if (!existsSync(destinationDir)) {
    mkdirSync(destinationDir, {recursive: true});
  }

  copyFileSync(dts, targetDts);
  copyFileSync(dts, targetDcts);
}

// Copy root styles declaration
copyDts(join(src, 'styles', 'index.d.ts'), join(dist, 'styles'));

// Create v0_8 styles directory in dist
mkdirSync(join(dist, 'v0_8', 'styles'), {recursive: true});

// Copy v0_8 styles declaration
copyDts(join(src, 'v0_8', 'styles', 'index.d.ts'), join(dist, 'v0_8', 'styles'));

console.log('Post-build style declarations copied successfully.');
