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

import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(__dirname, '../../../');

/**
 * ANSI escape codes for colorizing terminal output.
 */
export const ansi = {
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

/**
 * Directory names that never contain workspace packages: installed
 * dependencies, build output and Python virtual environments.
 */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'venv']);

/**
 * Returns whether a directory entry should be skipped when looking for packages.
 *
 * Hidden directories (`.git`, `.venv`, `.next`, `.wireit`, `.yarn`, ...) are
 * skipped as a group: none of them hold workspace packages, and a Python
 * `.venv` can bundle whole third-party Node monorepos (for example the
 * `@tsmono/*` packages inside `inspect_ai`) whose short names would otherwise
 * shadow `@a2ui/*` packages.
 *
 * @param {string} name - The directory entry name.
 * @returns {boolean} Whether to skip the entry.
 */
function isSkippedDirectory(name) {
  return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
}

/**
 * Finds all package.json files under `dir`, skipping hidden directories,
 * `node_modules`, `dist` and Python virtual environments.
 */
export function findPackages(dir = ROOT_DIR, packageList = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    if (isSkippedDirectory(file)) continue;

    const fullPath = join(dir, file);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      findPackages(fullPath, packageList);
    } else if (file === 'package.json') {
      packageList.push(fullPath);
    }
  }

  return packageList;
}

/**
 * Gets info about all packages and their internal dependencies.
 */
export function getPackageGraph() {
  const packagePaths = findPackages();
  const packages = {};

  for (const path of packagePaths) {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    if (!pkg.name) continue;
    const dir = dirname(path);

    // If we have a duplicate name, prioritize packages in 'typescript/'
    // or those that are not private (if one is private and other isn't)
    if (packages[pkg.name]) {
      const existing = packages[pkg.name];
      const isNewInTypeScript = dir.includes('/typescript/');
      const isExistingInTypeScript = existing.dir.includes('/typescript/');

      if (isExistingInTypeScript && !isNewInTypeScript) continue;
      if (isExistingInTypeScript === isNewInTypeScript) {
        const newScriptsCount = Object.keys(pkg.scripts || {}).length;
        const existingScriptsCount = Object.keys(
          JSON.parse(readFileSync(existing.path, 'utf8')).scripts || {},
        ).length;
        if (newScriptsCount <= existingScriptsCount) continue;
      }
    }

    packages[pkg.name] = {
      name: pkg.name,
      version: pkg.version,
      path: path,
      dir: dir,
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      peerDependencies: pkg.peerDependencies || {},
      private: !!pkg.private,
    };
  }

  // Build dependency map
  for (const name in packages) {
    const pkg = packages[name];
    pkg.internalDependencies = [];

    const allDeps = {...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies};
    for (const depName in allDeps) {
      if (packages[depName]) {
        pkg.internalDependencies.push(depName);
      }
    }
  }

  return packages;
}

/**
 * Increments a version string.
 * Supports: 0.9.2 -> 0.9.3, 0.9.2-beta.1 -> 0.9.2-beta.2
 */
export function incrementVersion(version) {
  const parts = version.split('.');
  const lastPart = parts[parts.length - 1];

  // Check if last part is numeric or ends with a number
  const match = lastPart.match(/^(.*?)(\d+)$/);
  if (match) {
    const prefix = match[1];
    const num = parseInt(match[2], 10);
    parts[parts.length - 1] = `${prefix}${num + 1}`;
    return parts.join('.');
  }

  return version + '.1'; // Fallback
}

/**
 * Converts a command and arguments to a readable string.
 */
function commandToString(command, args, options = {}) {
  const cwdMsg = options.cwd ? ` in ${options.cwd}` : '';
  return `${command} ${args.join(' ')}${cwdMsg}`;
}

/**
 * Runs a shell command and returns the result.
 */
export function runCommand(command, args, options = {}) {
  const commandStr = commandToString(command, args, options);
  console.log(`> Running: ${commandStr}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${commandStr}`);
  }

  return result;
}

/**
 * Runs a command or logs that it was skipped if in dry-run mode.
 *
 * The signature is similar to that of runCommand above, but with additional options for dry-run mode,
 * and to add the ability to mock the runCommand implementation (which is used as the default when a
 * mock is not provided).
 *
 * @param {string} command - The command to run.
 * @param {string[]} args - The arguments for the command.
 * @param {Object} [options={}] - Options for the command (e.g., cwd).
 * @param {Object} [settings={}] - Settings for execution.
 * @param {boolean} [settings.dryRun=false] - Whether dry-run mode is enabled.
 * @param {Function} [settings.runCommand] - Optional mock for runCommand.
 */
export function maybeRunCommand(command, args, options = {}, settings = {}) {
  const dryRun = settings.dryRun ?? false;
  const run = settings.runCommand || runCommand;

  if (dryRun) {
    console.log(
      `${ansi.yellow}[DRY RUN] Did NOT execute:${ansi.reset} ${commandToString(command, args, options)}`,
    );
  } else {
    run(command, args, options);
  }
}
