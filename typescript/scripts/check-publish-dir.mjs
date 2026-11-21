#!/usr/bin/env node
/**
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

import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Ensures that publishing is only triggered from a package's `dist/` directory.
 *
 * @param {string} [cwd=process.cwd()] - The working directory to verify.
 * @returns {boolean} Whether the directory basename is 'dist'.
 */
export function checkPublishDir(cwd = process.cwd()) {
  if (basename(cwd) !== 'dist') {
    console.error(
      'Error: This package must be published from the dist/ directory. Run `yarn build` then `cd dist && yarn npm publish`',
    );
    return false;
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!checkPublishDir()) {
    process.exit(1);
  }
}
