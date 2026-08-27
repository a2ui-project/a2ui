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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {execSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('a2ui CLI end-to-end command execution', () => {
  const cliPath = path.resolve(process.cwd(), 'dist/src/cli.js');
  const catalogPath = path.resolve(
    process.cwd(),
    '../../specification/v0_9_1/catalogs/basic/catalog.json',
  );

  it('prints help with codegen command', () => {
    const output = execSync(`node ${cliPath} --help`, {encoding: 'utf-8'});
    assert.ok(output.includes('Usage: a2ui [options] [command]'));
    assert.ok(output.includes('codegen'));
  });

  it('executes codegen and writes files into target output directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-cli-e2e-'));
    try {
      const output = execSync(
        `node ${cliPath} codegen --catalog ${catalogPath} --spec-version v0.9.1 --out ${tmpDir}`,
        {encoding: 'utf-8'},
      );
      assert.ok(output.includes('Successfully generated 5 files'));
      assert.ok(fs.existsSync(path.join(tmpDir, 'components.py')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'types.py')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'functions.py')));
      assert.ok(fs.existsSync(path.join(tmpDir, '__init__.py')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'py.typed')));
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });
});
