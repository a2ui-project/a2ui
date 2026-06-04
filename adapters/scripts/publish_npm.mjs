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

import {ansi, getPackageGraph, maybeRunCommand, runCommand} from './lib/workspace.mjs';
import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const {yellow, red, green, reset} = ansi;

/**
 * Topologically sorts package names based on their internal dependencies.
 *
 * @param {string[]} packageNames - The package names to sort.
 * @param {Object} graph - The package graph.
 * @returns {string[]} The sorted package names.
 */
function topologicalSort(packageNames, graph) {
  const sorted = [];
  const visited = new Set();
  const temp = new Set();

  function visit(name) {
    if (temp.has(name)) throw new Error(`Circular dependency detected involving ${name}`);
    if (visited.has(name)) return;

    temp.add(name);
    const pkg = graph[name];
    if (pkg) {
      for (const dep of pkg.internalDependencies) {
        if (packageNames.includes(dep)) {
          visit(dep);
        }
      }
    }
    temp.delete(name);
    visited.add(name);
    sorted.push(name);
  }

  for (const name of packageNames) {
    visit(name);
  }
  return sorted;
}

/**
 * Calculates the difference between two version strings.
 *
 * @param {string} oldV - The old version string.
 * @param {string} newV - The new version string.
 * @returns {string} The diff type (e.g., 'MAJOR', 'MINOR', 'PATCH', 'SAME', etc.)
 */
function getVersionDiff(oldV, newV) {
  if (oldV === newV) return 'SAME';
  const [oCore, ...oPreArr] = oldV.split('-');
  const [nCore, ...nPreArr] = newV.split('-');
  const oPre = oPreArr.join('-');
  const nPre = nPreArr.join('-');

  const [oMaj, oMin, oPat] = oCore.split('.').map(Number);
  const [nMaj, nMin, nPat] = nCore.split('.').map(Number);

  if (nMaj > oMaj) return nPre ? 'PREMAJOR' : 'MAJOR';
  if (nMaj === oMaj && nMin > oMin) return nPre ? 'PREMINOR' : 'MINOR';
  if (nMaj === oMaj && nMin === oMin && nPat > oPat) return nPre ? 'PREPATCH' : 'PATCH';
  if (oCore === nCore) {
    if (oPre && !nPre) return 'GRADUATION (RELEASE)';
    if (!oPre && nPre) return 'OLDER_OR_UNKNOWN';
    return 'PRERELEASE';
  }

  return 'OLDER_OR_UNKNOWN';
}

/**
 * Checks the current Git branch and commit.
 *
 * This method warns the user if there are uncommitted changes.
 * It also prints the current branch and commit hash. It returns the current commit hash.
 *
 * @param {Function} exec - The execSync function to use.
 * @returns {string} The current commit hash.
 */
function checkGitProvenance(exec) {
  console.log('\n--- Git Provenance Check ---');
  let currentBranch = 'unknown';
  let commitHash = 'unknown';
  let isDirty = false;

  try {
    currentBranch = exec('git rev-parse --abbrev-ref HEAD', {encoding: 'utf8'}).trim();
    commitHash = exec('git rev-parse HEAD', {encoding: 'utf8'}).trim();
    const status = exec('git status --porcelain', {encoding: 'utf8'}).trim();
    isDirty = status.length > 0;
  } catch (e) {
    // TODO: Should this throw an Error with {cause: e}?
    console.warn(
      `${yellow}⚠️ Could not verify Git status. Ensure you are in a valid Git repository.${reset}`,
    );
  }

  if (isDirty) {
    console.warn(
      `${yellow}\n⚠️  WARNING: Your Git working tree is DIRTY (you have uncommitted changes).${reset}`,
    );
    console.warn(
      `${yellow}Publishing from a dirty tree means the published code will NOT exactly match the commit history.${reset}`,
    );
    console.warn(
      `${yellow}It is highly recommended to commit or stash your changes before publishing.${reset}`,
    );
  }

  console.log(`Publishing from branch: ${currentBranch}`);
  console.log(`Commit hash: ${commitHash}`);

  return commitHash;
}

/**
 * Validates that core dependencies are included when publishing renderers.
 *
 * @param {string[]} packageNames - The package names to check.
 */
function checkCoreDependencies(packageNames) {
  const webCoreName = '@a2ui/web_core';
  const markdownItName = '@a2ui/markdown-it';
  const renderers = ['@a2ui/lit', '@a2ui/angular', '@a2ui/react'];
  const requestedRenderers = packageNames.filter(p => renderers.includes(p));

  if (requestedRenderers.length > 0) {
    const missingCores = [];
    if (!packageNames.includes(webCoreName)) missingCores.push(webCoreName);
    if (!packageNames.includes(markdownItName)) missingCores.push(markdownItName);

    if (missingCores.length > 0) {
      console.warn(
        `${yellow}WARNING: You are publishing renderers but NOT ${missingCores.join(' and ')}.${reset}`,
      );
      console.warn(
        `${yellow}This can lead to broken versions if shared dependencies have changed.${reset}`,
      );
      console.warn(`${yellow}Use --no-check-core-dependencies to override this check.${reset}`);
      throw new Error(
        `Safety check failed: ${missingCores.join(' and ')} missing from publish list.`,
      );
    }
  }
}

/**
 * Checks package versions against npmjs.
 *
 * @param {Object[]} packages - The package objects to check.
 * @param {Function} exec - The execSync function to use.
 */
function checkNpmVersions(packages, exec) {
  console.log('--- Pre-flight Version Checks ---');
  for (const pkg of packages) {
    const localVersion = pkg.version;
    let remoteVersion;

    try {
      remoteVersion = exec(`npm view ${pkg.name} version`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    } catch (e) {
      remoteVersion = null;
    }

    if (!remoteVersion) {
      console.log(
        `✅ [NEW PACKAGE] ${pkg.name}: Will be published for the first time as ${localVersion}`,
      );
      continue;
    }

    if (remoteVersion === localVersion) {
      console.error(`\n❌ ERROR: ${pkg.name} version ${localVersion} is already published on npm!`);
      console.error(
        `Please increment the version (e.g., using increment_version.mjs) before publishing.`,
      );
      throw new Error(`Version ${localVersion} already published.`);
    }

    const diff = getVersionDiff(remoteVersion, localVersion);
    if (diff === 'OLDER_OR_UNKNOWN') {
      console.error(
        `\n❌ ERROR: ${pkg.name} local version (${localVersion}) appears older or invalid compared to npm version (${remoteVersion})!`,
      );
      throw new Error(`Invalid version progression for ${pkg.name}.`);
    }

    console.log(`✅ [${diff}] ${pkg.name}: ${remoteVersion} -> ${localVersion}`);
  }
  console.log('\nPre-flight checks passed.');
}

/**
 * Builds and tests all targeted packages.
 *
 * @param {Object[]} packages - The package objects to build and test.
 * @param {Function} runCmd - The runCommand function to use.
 * @param {boolean} skipTests - Whether to skip tests.
 */
function buildAndTestPackages(packages, runCmd, skipTests) {
  console.log('\n--- Building and Testing all packages ---');
  for (const pkg of packages) {
    console.log(`\n=== Preparing ${pkg.name} (${pkg.version}) ===`);

    console.log(`- Running npm install in ${pkg.dir}`);
    runCmd('npm', ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: pkg.dir,
    });

    if (skipTests) {
      console.log(`- Skipping npm test for ${pkg.name}`);
    } else {
      const pkgJson = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8'));
      const testScript = pkgJson.scripts && pkgJson.scripts['test:ci'] ? 'test:ci' : 'test';

      console.log(`- Running npm run ${testScript} in ${pkg.dir}`);
      runCmd('npm', ['run', testScript], {cwd: pkg.dir});
    }
  }
}

export async function main(args, mocks = {}) {
  const runCmd = mocks.runCommand || runCommand;
  const exec = mocks.execSync || execSync;

  const options = {
    package: {
      type: 'string',
      short: 'p',
      multiple: true,
      default: [],
    },
    'check-core-dependencies': {
      type: 'boolean',
      default: true,
    },

    'dry-run': {
      type: 'boolean',
      default: true,
    },
    'skip-tests': {
      type: 'boolean',
      default: false,
    },
  };

  const {values} = parseArgs({args, options, allowNegative: true});
  const packagesToPublish = values.package;
  const checkCoreDeps = values['check-core-dependencies'];

  const dryRun = values['dry-run'];
  const skipTests = values['skip-tests'];

  if (packagesToPublish.length === 0) {
    throw new Error(
      'Usage: publish_npm --package=pkg1 --package=pkg2 [--no-check-core-dependencies] [--no-dry-run] [--skip-tests]',
    );
  }

  // Checks the status of the current git branch.
  const commitHash = checkGitProvenance(exec);

  const graph = getPackageGraph();

  // Resolve short names to full names
  const resolvedPackages = packagesToPublish.map(name => {
    const pkg = Object.values(graph).find(p => p.name === name || p.name.endsWith('/' + name));
    if (!pkg) {
      throw new Error(`Package "${name}" not found in workspace.`);
    }
    return pkg.name;
  });

  // Check that core dependencies are being published.
  if (checkCoreDeps) {
    checkCoreDependencies(resolvedPackages);
  }
  // Sort package names topologically (by dependency graph order).
  const sortedPackages = topologicalSort(resolvedPackages, graph);
  // Expands the list of topologically-sorted package names to package objects with additional dependency graph info.
  const packageObjects = sortedPackages.map(name => graph[name]);
  // Check the NPM versions of the packages we're about to publish.
  checkNpmVersions(packageObjects, exec);
  // Ensure packages can be built and tested.
  buildAndTestPackages(packageObjects, runCmd, skipTests);

  console.log('\n--- Proceeding to publish ---');
  console.log('\n--- Authenticating with Google Artifact Registry ---');
  maybeRunCommand('npx', ['google-artifactregistry-auth'], {}, {dryRun, runCommand: runCmd});

  for (const pkg of packageObjects) {
    console.log(`\n=== Publishing ${pkg.name} (${pkg.version}) ===`);
    console.log(`- Running publish:package in ${pkg.dir}`);
    maybeRunCommand(
      'npm',
      ['run', 'publish:package'],
      {cwd: pkg.dir},
      {dryRun, runCommand: runCmd},
    );
  }

  console.log(`\n${green}Done.${reset}`);
}

// Only run the script if this file is executed directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(err => {
    console.error(`${red}${err.message || err}${reset}`);
    process.exit(1);
  });
}
