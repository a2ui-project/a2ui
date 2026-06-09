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
import {parseArgs} from 'node:util';
import {getPackageGraph, incrementVersion, runCommand} from './lib/workspace.mjs';

const {values, positionals} = parseArgs({
  args: process.argv.slice(2),
  options: {
    'skip-sync': {
      type: 'boolean',
      default: false,
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`Usage: increment_version <package-name> [new-version] [options]

Increments the version of a specified package and synchronizes internal dependent packages.

Arguments:
  <package-name>    The name of the package to update (e.g., 'web_core' or '@a2ui/web_core').
  [new-version]     The specific new version to set (e.g., '1.0.1'). If omitted, increments
                    the version automatically based on current version string.

Options:
  --skip-sync       Skip synchronizing dependent packages (running yarn install in dependents).
  -h, --help        Show this complete help message.

Examples:
  # Increment version of web_core and sync dependents
  ./increment_version.mjs web_core

  # Set a specific version and skip syncing dependents
  ./increment_version.mjs web_core 1.2.0 --skip-sync`);
  process.exit(0);
}

const skipSync = values['skip-sync'];
const [targetName, targetVersion] = positionals;

if (!targetName) {
  console.error('Usage: increment_version <package-name> [new-version] [--skip-sync]');
  process.exit(1);
}

const graph = getPackageGraph();

// Find package by name or suffix (e.g. 'lit' matches '@a2ui/lit')
let pkg = graph[targetName];
if (!pkg) {
  pkg = Object.values(graph).find(p => p.name.endsWith('/' + targetName) || p.name === targetName);
}

if (!pkg) {
  console.error(`Package "${targetName}" not found.`);
  process.exit(1);
}

const oldVersion = pkg.version;
const newVersion = targetVersion || incrementVersion(oldVersion);

console.log(`Incrementing ${pkg.name}: ${oldVersion} -> ${newVersion}`);

// 1. Update target package.json
const pkgJson = JSON.parse(readFileSync(pkg.path, 'utf8'));
pkgJson.version = newVersion;
writeFileSync(pkg.path, JSON.stringify(pkgJson, null, 2) + '\n');

// 2. Find all internal dependents and sync them
const dependents = Object.values(graph).filter(p => p.internalDependencies.includes(pkg.name));

if (dependents.length > 0 && !skipSync) {
  console.log(`Updating ${dependents.length} dependents...`);
  for (const dep of dependents) {
    if (dep.name === '@a2ui/custom-components-example') {
      console.log(`- Skipping ${dep.name} (has broken external dependencies blocking npm install)`);
      continue;
    }
    console.log(`- Syncing ${dep.name} in ${dep.dir}`);
    // Update lockfiles normally using yarn
    runCommand('yarn', ['install'], {cwd: dep.dir});
  }
}

console.log('Done.');
