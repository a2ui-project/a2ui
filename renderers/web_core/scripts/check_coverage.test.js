// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import assert from 'node:assert';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const scriptPath = path.resolve(import.meta.dirname, 'check_coverage.js');
const tempLcovPath = path.resolve(import.meta.dirname, '../coverage.lcov');

function runScript() {
  try {
    const stdout = execSync(`node "${scriptPath}"`, {encoding: 'utf8', stdio: 'pipe'});
    return {status: 0, stdout};
  } catch (error) {
    return {status: error.status, stdout: error.stdout, stderr: error.stderr};
  }
}

test('check_coverage.js test cases', () => {
  // Backup existing coverage.lcov if exists
  const hasBackup = fs.existsSync(tempLcovPath);
  let backupContent = '';
  if (hasBackup) {
    backupContent = fs.readFileSync(tempLcovPath, 'utf8');
  }

  try {
    // Test case 1: Missing file
    if (hasBackup) fs.rmSync(tempLcovPath);
    const res1 = runScript();
    assert.strictEqual(res1.status, 1);
    assert.match(res1.stderr || res1.stdout, /Error: coverage.lcov not found/);

    // Test case 2: Empty / Invalid data
    fs.writeFileSync(tempLcovPath, 'SF:foo.js\nDA:1,0\n');
    const res2 = runScript();
    assert.strictEqual(res2.status, 1);
    assert.match(res2.stderr || res2.stdout, /Error: Invalid or missing coverage data/);

    // Test case 3: Low coverage
    fs.writeFileSync(tempLcovPath, 'SF:foo.js\nLF:10\nLH:5\n');
    const res3 = runScript();
    assert.strictEqual(res3.status, 1);
    assert.match(res3.stderr || res3.stdout, /FAIL: Code coverage/);

    // Test case 4: High coverage (passing)
    fs.writeFileSync(tempLcovPath, 'SF:foo.js\nLF:10\nLH:9\n');
    const res4 = runScript();
    assert.strictEqual(res4.status, 0);
    assert.match(res4.stdout, /PASS: Code coverage/);
  } finally {
    // Restore backup
    if (hasBackup) {
      fs.writeFileSync(tempLcovPath, backupContent);
    } else if (fs.existsSync(tempLcovPath)) {
      fs.rmSync(tempLcovPath);
    }
  }
});
