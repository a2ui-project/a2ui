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
import {main} from './upload_manifest.mjs';

describe('upload_manifest script integration test', () => {
  it('should generate manifest with publish_all: true by default', async () => {
    let writtenFileContent = null;

    const mocks = {
      runCommand: () => {},
      writeFileSync: (_, content) => {
        writtenFileContent = content;
      },
    };

    await main([], mocks);

    assert.ok(writtenFileContent, 'Should have written manifest file');
    const manifest = JSON.parse(writtenFileContent);
    assert.strictEqual(manifest.publish_all, true, 'Should default to publish_all: true');
  });

  it('should skip upload in dry-run mode by default', async () => {
    const executedCommands = [];

    const mocks = {
      runCommand: (cmd, args) => {
        executedCommands.push(`${cmd} ${args.join(' ')}`);
      },
      writeFileSync: () => {},
    };

    await main([], mocks);

    assert.strictEqual(executedCommands.length, 0, 'Should not execute commands in dry-run');
  });

  it('should generate manifest with publish_all: false when packages are specified', async () => {
    let writtenFileContent = null;

    const mocks = {
      runCommand: () => {},
      writeFileSync: (_, content) => {
        writtenFileContent = content;
      },
    };

    await main(['--package=angular', '-p', 'lit', '--package', 'react'], mocks);

    assert.ok(writtenFileContent, 'Should have written manifest file');

    const manifest = JSON.parse(writtenFileContent);
    assert.strictEqual(manifest.publish_all, false, 'Should set publish_all: false');
    assert.ok(manifest.publishing_groups, 'Should have publishing_groups');
    assert.strictEqual(manifest.publishing_groups.length, 1);
    assert.strictEqual(manifest.publishing_groups[0].namespace, '@a2ui');

    const packages = manifest.publishing_groups[0].packages;
    assert.strictEqual(packages.length, 3);
    assert.strictEqual(packages[0].name, 'angular');
    assert.strictEqual(packages[1].name, 'lit');
    assert.strictEqual(packages[2].name, 'react');
  });

  it('should attempt to upload to gcloud when --no-dry-run is passed', async () => {
    const executedCommands = [];

    const mocks = {
      runCommand: (cmd, args) => {
        executedCommands.push(`${cmd} ${args.join(' ')}`);
      },
      writeFileSync: () => {},
    };

    // --no-dry-run should trigger upload
    await main(['--no-dry-run'], mocks);

    assert.strictEqual(executedCommands.length, 1, 'Should execute one command');
    assert.ok(
      executedCommands[0].startsWith('gcloud storage cp'),
      'Should be gcloud upload command',
    );
  });
});
