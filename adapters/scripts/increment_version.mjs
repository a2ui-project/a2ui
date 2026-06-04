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
import {getPackageGraph, incrementVersion, runCommand} from './lib/workspace.mjs';

const args = process.argv.slice(2);
const skipSync = args.includes('--skip-sync');
const filteredArgs = args.filter(a => a !== '--skip-sync');
const [targetName, targetVersion] = filteredArgs;

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
    // Update lockfiles normally, but ignore scripts to prevent postinstall esbuild errors
    runCommand('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: dep.dir});
  }
}

console.log('Done.');
