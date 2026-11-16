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

import {existsSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {join, resolve, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCommand as defaultRunCommand} from './lib/workspace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Builds and publishes a package from its dist/ directory.
 *
 * @param {string[]} [args=[]] - CLI arguments.
 * @param {Object} [mocks={}] - Testing mocks.
 * @param {Function} [mocks.runCommand] - Command runner override.
 * @param {string} [mocks.cwd] - Current working directory override.
 */
export async function main(args = [], mocks = {}) {
  const runCommand = mocks.runCommand || defaultRunCommand;
  const packageDir = mocks.cwd || process.cwd();
  const distDir = resolve(packageDir, 'dist');
  const pkgJsonPath = join(packageDir, 'package.json');

  let pkg = {};
  if (existsSync(pkgJsonPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch (err) {
      console.warn(`Warning: Failed to parse package.json at ${pkgJsonPath}:`, err.message);
    }
  }

  const skipPrepare =
    args.includes('--skip-prepare') || Boolean(pkg.devDependencies?.['ng-packagr']);

  // 1. Build the package
  runCommand('yarn', ['build'], {cwd: packageDir});

  // 2. Prepare publish if not skipped
  if (!skipPrepare) {
    const prepareScript = resolve(__dirname, 'prepare-publish.mjs');
    runCommand('node', [prepareScript], {cwd: packageDir});
  }

  if (!existsSync(distDir)) {
    throw new Error(`Directory '${distDir}' does not exist after build.`);
  }

  const yarnLockPath = join(distDir, 'yarn.lock');
  const nodeModulesPath = join(distDir, 'node_modules');
  const createdYarnLock = !existsSync(yarnLockPath);
  const hadNodeModules = existsSync(nodeModulesPath);

  try {
    // 3. Establish package boundary in dist/
    if (createdYarnLock) {
      writeFileSync(yarnLockPath, '');
    }

    // 4. Install dependencies in dist/
    runCommand('yarn', ['install'], {cwd: distDir});

    // 5. Publish to npm
    const publishArgs = ['npm', 'publish'];
    const forwardedArgs = args.filter(arg => arg !== '--skip-prepare');
    if (forwardedArgs.length > 0) {
      publishArgs.push(...forwardedArgs);
    }
    if (!publishArgs.some(arg => arg === '--access' || arg.startsWith('--access='))) {
      publishArgs.push('--access', 'public');
    }

    runCommand('yarn', publishArgs, {
      cwd: distDir,
      env: process.env,
    });
  } finally {
    // 6. Clean up temporary boundary and install artifacts
    if (createdYarnLock && existsSync(yarnLockPath)) {
      try {
        rmSync(yarnLockPath, {force: true});
      } catch (err) {
        console.warn(`Warning: Failed to clean up temporary yarn.lock:`, err.message);
      }
    }
    if (!hadNodeModules && existsSync(nodeModulesPath)) {
      const resolvedTarget = resolve(nodeModulesPath);
      const cwd = process.cwd();
      if (
        resolvedTarget === '/' ||
        cwd === resolvedTarget ||
        cwd.startsWith(resolvedTarget + sep)
      ) {
        console.warn(
          'Warning: Safety check failed: Target directory resolves to root or an ancestor of the current working directory.',
        );
      } else {
        try {
          rmSync(nodeModulesPath, {recursive: true, force: true});
        } catch (err) {
          console.warn('Warning: Failed to clean up temporary node_modules:', err.message);
        }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
