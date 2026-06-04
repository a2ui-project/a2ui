#!/usr/bin/env node
/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {main} from './publish_npm.mjs';

describe('publish_npm script integration test', () => {
  it('should topologically sort packages based on dependencies', async () => {
    const executedCommands = [];
    const mocks = {
      runCommand: (cmd, args, options) => {
        executedCommands.push(
          `${cmd} ${args.join(' ')} (in ${options?.cwd ? options.cwd.split('/').pop() : 'root'})`,
        );
      },
      execSync: cmd => {
        if (cmd.includes('npm view')) return '0.0.1\n';
        return '';
      },
    };

    await main(
      [
        '--package=lit',
        '--package=web_core',
        '--package=markdown-it',
        '--skip-tests',
        '--no-dry-run',
      ],
      mocks,
    );

    const webCoreInstallIndex = executedCommands.findIndex(
      cmd => cmd.includes('install') && cmd.includes('web_core'),
    );
    const markdownItInstallIndex = executedCommands.findIndex(
      cmd => cmd.includes('install') && cmd.includes('markdown-it'),
    );
    const litInstallIndex = executedCommands.findIndex(
      cmd => cmd.includes('install') && cmd.includes('lit'),
    );

    assert.ok(webCoreInstallIndex < litInstallIndex, 'web_core must be prepared before lit');
    assert.ok(markdownItInstallIndex < litInstallIndex, 'markdown-it must be prepared before lit');
  });

  it('should default to dry-run mode (skip auth and publish)', async () => {
    const executedCommands = [];
    const mocks = {
      runCommand: (cmd, args) => {
        executedCommands.push(`${cmd} ${args.join(' ')}`);
      },
      execSync: cmd => {
        if (cmd.includes('npm view')) return '0.0.1\n';
        return '';
      },
    };

    await main(['--package=web_core'], mocks);

    const hasAuth = executedCommands.some(cmd => cmd.includes('google-artifactregistry-auth'));
    const hasPublish = executedCommands.some(cmd => cmd.includes('publish:package'));
    const hasInstall = executedCommands.some(cmd => cmd.includes('npm install'));

    assert.strictEqual(hasAuth, false, 'Should NOT authenticate in dry-run');
    assert.strictEqual(hasPublish, false, 'Should NOT publish in dry-run');
    assert.ok(hasInstall, 'Should still run npm install in dry-run by default');
  });

  it('should authenticate and publish when --no-dry-run is passed', async () => {
    const executedCommands = [];
    const mocks = {
      runCommand: (cmd, args) => {
        executedCommands.push(`${cmd} ${args.join(' ')}`);
      },
      execSync: cmd => {
        if (cmd.includes('npm view')) return '0.0.1\n';
        return '';
      },
    };

    await main(['--package=web_core', '--no-dry-run'], mocks);

    const hasAuth = executedCommands.some(cmd => cmd.includes('google-artifactregistry-auth'));
    const hasPublish = executedCommands.some(cmd => cmd.includes('publish:package'));

    assert.ok(hasAuth, 'Should authenticate when --no-dry-run is passed');
    assert.ok(hasPublish, 'Should publish when --no-dry-run is passed');
  });

  it('should skip tests when --skip-tests is passed', async () => {
    const executedCommands = [];
    const mocks = {
      runCommand: (cmd, args) => {
        executedCommands.push(`${cmd} ${args.join(' ')}`);
      },
      execSync: cmd => {
        if (cmd.includes('npm view')) return '0.0.1\n';
        return '';
      },
    };

    await main(['--package=web_core', '--skip-tests'], mocks);

    const hasTest = executedCommands.some(cmd => cmd.includes('npm run test'));
    assert.strictEqual(hasTest, false, 'Should NOT run tests when --skip-tests is passed');
  });

  it('should fail safety check if core dependencies are missing', async () => {
    const mocks = {
      runCommand: () => {},
      execSync: () => '',
    };

    await assert.rejects(
      async () => {
        await main(['--package=lit'], mocks);
      },
      /.*/, // The script will emit an error with some details.
      'Should fail when web_core and markdown-it are missing',
    );
  });

  it('should bypass safety check when --no-check-core-dependencies is passed', async () => {
    const executedCommands = [];
    const mocks = {
      runCommand: (cmd, args) => {
        executedCommands.push(`${cmd} ${args.join(' ')}`);
      },
      execSync: cmd => {
        if (cmd.includes('npm view')) return '0.0.1\n';
        return '';
      },
    };

    await main(['--package=lit', '--no-check-core-dependencies'], mocks);

    const hasInstall = executedCommands.some(cmd => cmd.includes('npm install'));
    assert.ok(hasInstall, 'Should proceed to install');
  });
});
