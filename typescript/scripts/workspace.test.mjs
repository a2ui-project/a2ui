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

import assert from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {after, before, describe, it} from 'node:test';

import {findPackages} from './lib/workspace.mjs';

/**
 * Writes an empty package.json at `dir/.../package.json`, creating directories as needed.
 *
 * @param {string} root - The temporary repository root.
 * @param {string} dir - The package directory, relative to `root`.
 */
function writePackage(root, dir) {
  mkdirSync(join(root, dir), {recursive: true});
  writeFileSync(join(root, dir, 'package.json'), '{}\n');
}

describe('findPackages', () => {
  let root;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'a2ui-workspace-test-'));
    writePackage(root, '.');
    writePackage(root, 'typescript/core/web_core');
    writePackage(root, 'typescript/renderers/react');
    writePackage(root, 'samples/client/react');
    // A directory whose name merely starts with "dist" is a regular directory.
    writePackage(root, 'distributions/pkg');
    // Directories that must not contribute packages: hidden directories,
    // installed dependencies, build output and Python virtual environments.
    writePackage(root, '.git/hooks');
    writePackage(root, '.next/cache');
    writePackage(root, '.wireit/cache');
    writePackage(root, '.yarn/cache/pkg');
    writePackage(
      root,
      '.venv/lib/python3.12/site-packages/inspect_ai/_view/ts-mono/packages/react',
    );
    writePackage(root, 'venv/lib/site-packages/some_tool/ui');
    writePackage(root, 'node_modules/react');
    writePackage(root, 'typescript/core/web_core/dist');
  });

  after(() => {
    if (root) {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it('finds workspace packages and ignores hidden, dependency, build and virtualenv directories', () => {
    const found = findPackages(root)
      .map(path => relative(root, path))
      .sort();
    assert.deepStrictEqual(found, [
      'distributions/pkg/package.json',
      'package.json',
      'samples/client/react/package.json',
      'typescript/core/web_core/package.json',
      'typescript/renderers/react/package.json',
    ]);
  });
});
