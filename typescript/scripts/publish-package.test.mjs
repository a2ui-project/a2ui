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

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {main} from './publish-package.mjs';

describe('publish-package script', () => {
  function setupTempPackage(pkgJson = {name: 'test-pkg', version: '1.0.0'}) {
    const tempDir = mkdtempSync(join(tmpdir(), 'a2ui-pub-pkg-test-'));
    const distDir = join(tempDir, 'dist');
    mkdirSync(distDir);
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
    return {tempDir, distDir};
  }

  it('runs build, prepare-publish, install and publish, then cleans up temporary yarn.lock', async () => {
    const {tempDir, distDir} = setupTempPackage();
    const executedCommands = [];

    const mocks = {
      cwd: tempDir,
      runCommand: (cmd, args, options) => {
        executedCommands.push({cmd, args, cwd: options?.cwd});
      },
    };

    try {
      await main([], mocks);

      assert.strictEqual(executedCommands[0].cmd, 'yarn');
      assert.deepStrictEqual(executedCommands[0].args, ['build']);
      assert.strictEqual(executedCommands[0].cwd, tempDir);

      assert.strictEqual(executedCommands[1].cmd, 'node');
      assert.ok(executedCommands[1].args[0].endsWith('prepare-publish.mjs'));
      assert.strictEqual(executedCommands[1].cwd, tempDir);

      assert.strictEqual(executedCommands[2].cmd, 'yarn');
      assert.deepStrictEqual(executedCommands[2].args, ['install']);
      assert.strictEqual(executedCommands[2].cwd, distDir);

      assert.strictEqual(executedCommands[3].cmd, 'yarn');
      assert.deepStrictEqual(executedCommands[3].args, ['npm', 'publish', '--access', 'public']);
      assert.strictEqual(executedCommands[3].cwd, distDir);

      // Temporary yarn.lock should be cleaned up
      assert.strictEqual(existsSync(join(distDir, 'yarn.lock')), false);
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it('skips prepare-publish when --skip-prepare is passed', async () => {
    const {tempDir} = setupTempPackage();
    const executedCommands = [];

    const mocks = {
      cwd: tempDir,
      runCommand: (cmd, args, options) => {
        executedCommands.push({cmd, args, cwd: options?.cwd});
      },
    };

    try {
      await main(['--skip-prepare'], mocks);

      const prepareCmd = executedCommands.find(
        c => c.cmd === 'node' && c.args[0]?.endsWith('prepare-publish.mjs'),
      );
      assert.strictEqual(prepareCmd, undefined);

      const publishCmd = executedCommands.find(c => c.args.includes('publish'));
      assert.ok(publishCmd);
      assert.deepStrictEqual(publishCmd.args, ['npm', 'publish', '--access', 'public']);
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it('cleans up temporary yarn.lock even if publish fails', async () => {
    const {tempDir, distDir} = setupTempPackage();

    const mocks = {
      cwd: tempDir,
      runCommand: (cmd, args) => {
        if (args.includes('publish')) {
          throw new Error('Publish network failure');
        }
      },
    };

    try {
      await assert.rejects(
        async () => {
          await main([], mocks);
        },
        {message: 'Publish network failure'},
      );

      assert.strictEqual(existsSync(join(distDir, 'yarn.lock')), false);
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it('preserves compound --access argument without duplicating', async () => {
    const {tempDir} = setupTempPackage();
    const executedCommands = [];

    const mocks = {
      cwd: tempDir,
      runCommand: (cmd, args, options) => {
        executedCommands.push({cmd, args, cwd: options?.cwd});
      },
    };

    try {
      await main(['--access=restricted'], mocks);

      const publishCmd = executedCommands.find(c => c.args.includes('publish'));
      assert.ok(publishCmd);
      assert.deepStrictEqual(publishCmd.args, ['npm', 'publish', '--access=restricted']);
    } finally {
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  it('logs a warning when package.json is malformed', async () => {
    const {tempDir} = setupTempPackage();
    writeFileSync(join(tempDir, 'package.json'), '{ malformed json');
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = msg => warnings.push(msg);

    const mocks = {
      cwd: tempDir,
      runCommand: () => {},
    };

    try {
      await main([], mocks);
      assert.ok(warnings.some(w => w.includes('Failed to parse package.json')));
    } finally {
      console.warn = originalWarn;
      rmSync(tempDir, {recursive: true, force: true});
    }
  });
});
