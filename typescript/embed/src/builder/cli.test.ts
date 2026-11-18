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

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {createFixtureProject, type FixtureProject} from './testing/fixture_project.js';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** Runs the CLI from its sources in `cwd` and returns its exit code and output. */
async function runCli(
  args: string[],
  cwd: string,
): Promise<{code: number; stdout: string; stderr: string}> {
  try {
    const {stdout, stderr} = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', CLI, ...args],
      {cwd},
    );
    return {code: 0, stdout, stderr};
  } catch (error) {
    const {code, stdout, stderr} = error as {code: number; stdout: string; stderr: string};
    return {code, stdout, stderr};
  }
}

describe('a2ui-embed', () => {
  let project: FixtureProject;

  beforeEach(async () => {
    project = await createFixtureProject();
  });

  afterEach(() => project.remove());

  it('builds the app with the real runtime and reports the written files', async () => {
    await project.write({
      'a2ui-embed.config.mjs': `
import {basicCatalog, defineConfig} from '@a2ui/embed/build';
export default defineConfig({catalogs: [basicCatalog], output: 'dist/app.html'});
`,
    });

    const {code, stdout, stderr} = await runCli(['build'], project.dir);

    assert.equal(stderr, '');
    assert.equal(code, 0);
    assert.match(
      stdout,
      /^Wrote dist\/app\.html \(\d+\.\d (KiB|MiB)\) and dist\/app\.catalog\.json\n$/,
    );
    const html = await readFile(join(project.dir, 'dist/app.html'), 'utf8');
    assert.match(html, /^<!doctype html>/);
    const schema = JSON.parse(await readFile(join(project.dir, 'dist/app.catalog.json'), 'utf8'));
    assert.deepEqual(Object.keys(schema.catalogs), [
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
    ]);
  });

  it('runs as the a2ui-embed bin of the built package', async () => {
    const {bin} = JSON.parse(await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8'));

    // Runs the file directly, so it needs its shebang and the execute bit.
    const {stdout} = await promisify(execFile)(join(PACKAGE_DIR, bin['a2ui-embed']), ['--help'], {
      cwd: project.dir,
    });

    assert.match(stdout, /^Usage: a2ui-embed build \[--config <path>\]/);
  });

  it('prints the usage for --help', async () => {
    const {code, stdout} = await runCli(['--help'], project.dir);

    assert.equal(code, 0);
    assert.match(stdout, /^Usage: a2ui-embed build \[--config <path>\]/);
  });

  it('fails with the usage for an unknown command', async () => {
    const {code, stderr} = await runCli(['serve'], project.dir);

    assert.equal(code, 1);
    assert.match(stderr, /^Usage: a2ui-embed build/);
  });

  it('fails with the usage for an unknown option', async () => {
    const {code, stderr} = await runCli(['build', '--out', 'x'], project.dir);

    assert.equal(code, 1);
    assert.match(stderr, /Unknown option '--out'[^]*Usage: a2ui-embed build/);
  });

  it('reports a build error without a stack trace', async () => {
    const {code, stderr} = await runCli(['build', '--config', 'missing.mjs'], project.dir);

    assert.equal(code, 1);
    assert.match(stderr, /^Could not bundle the config file .*missing\.mjs/);
    assert.doesNotMatch(stderr, /\n\s+at /);
  });
});
