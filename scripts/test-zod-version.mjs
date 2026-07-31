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

import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const packageJsonPath = join(rootDir, 'package.json');

// The workspaces (packages) that should be cleaned and tested against the target Zod version.
// NOTE: @a2ui/web_core MUST be first because the others depend on it.
const targetWorkspaces = ['@a2ui/web_core', '@a2ui/lit', '@a2ui/react', '@a2ui/angular'];

// Parse arguments
let targetVersion = '^3.25.0'; // Default
const versionArgIndex = process.argv.findIndex(arg => arg.startsWith('--version'));

if (versionArgIndex !== -1) {
  const versionArg = process.argv[versionArgIndex];
  if (versionArg.includes('=')) {
    targetVersion = versionArg.split('=')[1];
  } else if (versionArgIndex < process.argv.length - 1) {
    targetVersion = process.argv[versionArgIndex + 1];
  }
}

console.log(`= Starting Zod ${targetVersion} Compatibility Test Runner`);

// Read original package.json
const originalPkgContent = readFileSync(packageJsonPath, 'utf-8');
const pkg = JSON.parse(originalPkgContent);

console.log('\nSetting Zod resolution to:', targetVersion);

pkg.resolutions.zod = targetVersion;
writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

let testPassed = false;
let installedZodVersion;
try {
  console.log(`\n== Running yarn install to resolve Zod ${targetVersion}...`);
  execSync('yarn install', {cwd: rootDir, stdio: 'inherit'});

  try {
    // Retrieve the installed zod version.
    const zodPkgPath = join(rootDir, 'node_modules', 'zod', 'package.json');
    const zodPkg = JSON.parse(readFileSync(zodPkgPath, 'utf-8'));
    installedZodVersion = zodPkg.version;
    console.log('* Actual zod version:', installedZodVersion);
  } catch (e) {
    throw new Error(
      `Failed to detect installed Zod version at ${join('node_modules', 'zod', 'package.json')}`,
      {cause: e},
    );
  }

  console.log(`\n== Building @a2ui/web_core with zod@${installedZodVersion}`);
  for (const ws of targetWorkspaces) {
    execSync(`yarn workspace ${ws} clean`, {cwd: rootDir, stdio: 'inherit'});
  }
  execSync('yarn workspace @a2ui/web_core build', {cwd: rootDir, stdio: 'inherit'});

  console.log(`\n== Running tests with zod@${installedZodVersion}`);
  targetWorkspaces.forEach((ws, index) => {
    const progress = `${index + 1}/${targetWorkspaces.length}`;
    console.log(`\n=== Testing ${ws} with zod@${installedZodVersion} (${progress})`);
    execSync(`yarn workspace ${ws} test`, {cwd: rootDir, stdio: 'inherit'});
  });
  testPassed = true;
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  }
} finally {
  console.log('\n== Restoring workspace');
  writeFileSync(packageJsonPath, originalPkgContent, 'utf-8');
  try {
    execSync('yarn install', {cwd: rootDir, stdio: 'inherit'});
    for (const ws of targetWorkspaces) {
      execSync(`yarn workspace ${ws} clean`, {cwd: rootDir, stdio: 'inherit'});
    }
    execSync('yarn workspace @a2ui/web_core build', {cwd: rootDir, stdio: 'inherit'});
    console.log('Workspace restored successfully.');
  } catch (restoreError) {
    console.error('Failed to restore workspace:', restoreError);
  }
}

if (testPassed) {
  console.log(
    `\n=== All tests PASSED with zod@${installedZodVersion || 'unknown'} (target: ${targetVersion})\n`,
  );
} else {
  console.error(
    `\n=== Test suite FAILED with zod@${installedZodVersion || 'unknown'} (target: ${targetVersion})\n`,
  );
  process.exit(1);
}
