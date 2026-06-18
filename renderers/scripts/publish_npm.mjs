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
 * Topologically sorts package objects based on their internal dependencies.
 *
 * @param {Object[]} packageObjects - The package objects to sort.
 * @returns {Object[]} The incoming package objects topologically sorted.
 */
function topologicalSort(packageObjects) {
  const sorted = [];
  const visited = new Set();
  const temp = new Set();

  // Create a map from package name to its package object.
  const objectMap = Object.fromEntries(packageObjects.map(p => [p.name, p]));

  function visit(pkg) {
    const name = pkg.name;
    if (temp.has(name)) throw new Error(`Circular dependency detected involving ${name}`);
    if (visited.has(name)) return;

    temp.add(name);
    for (const dep of pkg.internalDependencies) {
      if (dep in objectMap) {
        visit(objectMap[dep]);
      }
    }
    temp.delete(name);
    visited.add(name);
    sorted.push(pkg);
  }

  for (const pkg of packageObjects) {
    visit(pkg);
  }
  return sorted;
}

/**
 * Calculates the difference between two version strings.
 *
 * @param {string | null} oldV - The old version string.
 * @param {string} newV - The new version string.
 * @returns {string} The diff type (e.g., 'MAJOR', 'MINOR', 'PATCH', 'SAME', etc.)
 */
function getVersionDiff(oldV, newV) {
  if (oldV == null) return 'NEW';
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
 * Ensures that web_core and markdown-it are present in artifact registry so they can be resolved
 * when preparing the dist build of packageNames.
 *
 * @param {string[]} packageNames - The package names to check.
 * @returns {string[]} The package names including web_core and markdown-it.
 */
function ensureCoreDependencies(packageNames) {
  const corePackages = ['@a2ui/markdown-it', '@a2ui/web_core'];

  const resolvedPackages = [...packageNames];
  const missingCore = corePackages.filter(name => !resolvedPackages.includes(name));

  resolvedPackages.push(...missingCore);
  if (missingCore.length > 0) {
    console.warn(
      `${yellow}Automatically added: ${missingCore.join(' and ')} to packages to publish.${reset}`,
    );
  }
  return resolvedPackages;
}

/**
 * Gets the version of a package on npm.
 *
 * @param {Object} pkg - The package to check.
 * @param {Function} exec - The execSync function to use.
 * @returns {string|null} The version of the package on npm, or null if it does not exist.
 */
function getNpmVersion(pkg, npmToken, exec) {
  try {
    const remoteVersionJson = exec(`yarn npm info ${pkg.name} --fields version --json`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {...process.env, NPM_TOKEN: npmToken},
    }).trim();
    const remoteVersion = JSON.parse(remoteVersionJson)?.version;
    return remoteVersion;
  } catch (e) {
    return null;
  }
}

/**
 * Filters the incoming packages list, and returns another one with the packages that should be published.
 *
 * This method skips packages that are published in the same version, fails if the published version
 * is newwer than the local version, and congratulates the user in other cases.
 *
 * @param {Object[]} packages - The package objects to check.
 * @param {Function} exec - The execSync function to use.
 */
function filterPublishablePackages(packages, npmToken, exec) {
  const packagesToPublish = [];
  for (const pkg of packages) {
    const localVersion = pkg.version;
    const remoteVersion = getNpmVersion(pkg, npmToken, exec);
    const diff = getVersionDiff(remoteVersion, localVersion);
    switch (diff) {
      case 'NEW':
        console.log(
          `✅ [NEW PACKAGE] ${pkg.name}: Will be published for the first time as ${localVersion}`,
        );
        packagesToPublish.push(pkg);
        break;
      case 'SAME':
        console.warn(
          `⚠️ WARNING: ${pkg.name} version ${localVersion} is already published on npm. Skipping.`,
        );
        break;
      case 'OLDER_OR_UNKNOWN':
        console.error(
          `❌ ERROR: ${pkg.name} local version (${localVersion}) appears older or invalid compared to npm version (${remoteVersion})!`,
        );
        throw new Error(`Invalid version progression for ${pkg.name}.`);
      default:
        console.log(`✅ [${diff}] ${pkg.name}: ${remoteVersion} -> ${localVersion}`);
        packagesToPublish.push(pkg);
        break;
    }
  }
  return packagesToPublish;
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

    console.log(`- Running yarn install in ${pkg.dir}`);
    runCmd('yarn', ['install'], {
      cwd: pkg.dir,
    });

    if (skipTests) {
      console.log(`- Skipping yarn test for ${pkg.name}`);
    } else {
      const pkgJson = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8'));
      const testScript = pkgJson.scripts && pkgJson.scripts['test:ci'] ? 'test:ci' : 'test';

      console.log(`- Running yarn run ${testScript} in ${pkg.dir}`);
      runCmd('yarn', ['run', testScript], {cwd: pkg.dir});
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
    'dry-run': {
      type: 'boolean',
      default: true,
    },
    'skip-tests': {
      type: 'boolean',
      default: false,
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
  };

  const {values} = parseArgs({args, options, allowNegative: true});

  if (values.help) {
    console.log(`Usage: publish_npm [options]

Publishes A2UI workspace packages to NPM / Artifact Registry in topological dependency order.

Options:
  -p, --package <name>                 Package(s) to publish. Can be specified multiple times.
                                       Accepts short names (e.g., 'web_core') or scoped names (e.g., '@a2ui/web_core').
  --check-core-dependencies            Verify that core dependencies are also being published.
  --no-check-core-dependencies         Skip core dependencies verification.
  --dry-run                            Perform a dry run without actually publishing or obtaining auth tokens (default).
  --no-dry-run                         Actually publish the packages and obtain fresh auth tokens.
  --skip-tests                         Skip building and testing packages before publishing.
  -h, --help                           Show this complete help message.

Examples:
  # Dry run publishing a single package
  ./publish_npm.mjs --package=web_core

  # Actually publish multiple packages, skipping tests
  ./publish_npm.mjs -p web_core -p react --no-dry-run --skip-tests`);
    return;
  }
  let packagesToPublish = values.package;

  const dryRun = values['dry-run'];
  const skipTests = values['skip-tests'];

  if (packagesToPublish.length === 0) {
    throw new Error(
      'Usage: publish_npm --package=pkg1 --package=pkg2 [--no-check-core-dependencies] [--no-dry-run] [--skip-tests]',
    );
  }

  // Ensure the core packages are published.
  packagesToPublish = ensureCoreDependencies(packagesToPublish);

  // Checks the status of the current git branch.
  const commitHash = checkGitProvenance(exec);

  const graph = getPackageGraph();

  // Resolve short names to full names
  const resolvedPackages = packagesToPublish.map(name => {
    const pkg = Object.values(graph).find(p => p.name === name || p.name.endsWith('/' + name));
    if (!pkg) {
      throw new Error(`Package "${name}" not found in workspace.`);
    }
    return pkg;
  });

  let npmToken = process.env.NPM_TOKEN;
  if (!npmToken) {
    console.log(`- Obtaining fresh Artifact Registry token via gcloud CLI`);
    try {
      npmToken = exec('gcloud auth print-access-token', {encoding: 'utf8'}).trim();
    } catch (e) {
      console.warn(
        `${yellow}⚠️ Could not obtain gcloud access token. Ensure you are logged in (${reset}gcloud auth login${yellow}).${reset}`,
      );
    }
  }

  // Sort packages topologically (by dependency graph order).
  const packageObjects = topologicalSort(
    filterPublishablePackages(resolvedPackages, npmToken, exec),
  );

  // Ensure packages can be built and tested.
  buildAndTestPackages(packageObjects, runCmd, skipTests);

  console.log('\n--- Proceeding to publish ---');

  for (const pkg of packageObjects) {
    console.log(`\n=== Publishing ${pkg.name} (${pkg.version}) ===`);

    console.log(`- Running publish:package in ${pkg.dir}`);
    maybeRunCommand(
      'yarn',
      ['run', 'publish:package'],
      {
        cwd: pkg.dir,
        env: {...process.env, NPM_TOKEN: npmToken},
      },
      {dryRun, runCommand: runCmd},
    );
  }

  if (!dryRun) {
    console.log('Uploaded artifacts to: go/a2ui-oss-exit-gate-artifacts');
  }
  console.log(`${green}Done.${reset}`);
}

// Only run the script if this file is executed directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(err => {
    console.error(`${red}${err.message || err}${reset}`);
    process.exit(1);
  });
}
