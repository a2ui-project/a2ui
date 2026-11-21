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
 * Captures a trimmed snapshot of a repository for fixture mode:
 * labels, milestones, assignees, every open issue (without bodies), bodies and
 * recent comments of 40 issues (untriaged first) and 10 PRs with files and
 * checks. Reads only; needs `yarn build` first.
 *
 * Usage: GITHUB_TOKEN=... node scripts/capture-fixtures.mjs [owner/name] [out-dir]
 * Defaults: GITHUB_REPO or a2ui-project/a2ui, and fixtures-local/<name>.
 * Without GITHUB_TOKEN, it reads the token from `gh auth token`.
 */

import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {RestGitHub} from '../dist/github/rest.js';
import {captureSnapshot} from '../dist/github/snapshot.js';
import {SNAPSHOT_FILE} from '../dist/github/fixture.js';
import {loadEnvFile} from '../dist/config.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile(process.env, join(packageRoot, '.env'));

function token() {
  if (process.env['GITHUB_TOKEN']) return process.env['GITHUB_TOKEN'];
  const gh = process.env['GH_PATH'] ?? 'gh';
  return execFileSync(gh, ['auth', 'token'], {encoding: 'utf8'}).trim();
}

const repo = process.argv[2] ?? process.env['GITHUB_REPO'] ?? 'a2ui-project/a2ui';
const outDir = process.argv[3] ?? join(packageRoot, 'fixtures-local', repo.split('/')[1]);

const snapshot = await captureSnapshot(new RestGitHub({repo, token: token()}));
mkdirSync(outDir, {recursive: true});
const file = join(outDir, SNAPSHOT_FILE);
writeFileSync(file, `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(
  `Captured ${snapshot.issues.length} open issues (${Object.keys(snapshot.details).length} with bodies), ` +
    `${snapshot.pulls.length} PRs, ${snapshot.labels.length} labels, ${snapshot.milestones.length} milestones ` +
    `and ${snapshot.assignees.length} assignees of ${repo} into ${file}.`,
);
