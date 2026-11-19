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
 * Downloads the Chinook sample database (MIT-licensed, Copyright (c) 2008-2024
 * Luis Rocha, https://github.com/lerocha/chinook-database) into the
 * gitignored `data/` directory. Skips the download when the file exists.
 */

import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const VERSION = 'v1.4.5';
const URL = `https://github.com/lerocha/chinook-database/releases/download/${VERSION}/Chinook_Sqlite.sqlite`;
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'chinook.sqlite');

if (existsSync(target)) {
  console.log(`${target} already exists.`);
} else {
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') {
    throw new Error('The download is not a SQLite database.');
  }
  await mkdir(dirname(target), {recursive: true});
  await writeFile(target, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(
    `Downloaded Chinook ${VERSION} to ${target} (${bytes.length} bytes, sha256 ${sha256}).`,
  );
}
