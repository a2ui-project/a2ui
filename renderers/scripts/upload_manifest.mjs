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

import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getPackageGraph, ROOT_DIR, ansi, maybeRunCommand} from './lib/workspace.mjs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

// Configuration - adjust these as needed for your environment
const GCS_URI =
  process.env.A2UI_NPM_MANIFEST_GCS_URI ||
  'gs://oss-exit-gate-prod-projects-bucket/a2ui/npm/manifests';

const {red, green, reset, bold} = ansi;

/**
 * Prints the command line usage instructions and examples.
 */
function printHelp() {
  console.log(`Usage: upload_manifest [options]

Triggers a public release via Exit Gate by uploading a release manifest.

Options:
  -p, --package <name>                 Package(s) to trigger release for. Can be specified multiple times.
  --no-dry-run                         Actually trigger the release via Exit Gate.
  -h, --help                           Show this complete help message.

Examples:
  # Dry run release trigger for a single package
  ./upload_manifest.mjs --package=web_core

  # Actually trigger public release for multiple packages
  ./upload_manifest.mjs -p web_core -p lit --no-dry-run`);
}

/**
 * Triggers a public release via Exit Gate by uploading a release manifest.
 *
 * @param {string[]} args - Command line arguments.
 * @param {Object} [mocks={}] - Mock objects for testing.
 * @param {Function} [mocks.runCommand] - Optional mock for runCommand.
 * @param {Function} [mocks.writeFileSync] - Optional mock for writeFileSync.
 */
export async function main(args, mocks = {}) {
  const runCmd = mocks.runCommand;
  const writeFile = mocks.writeFileSync || writeFileSync;
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
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
  };

  const {values} = parseArgs({args, options, allowNegative: true});
  const packagesToPublish = values.package;
  const isDryRun = values['dry-run'];

  if (values.help) {
    printHelp();
    return;
  }

  if (packagesToPublish.length === 0) {
    printHelp();
    throw new Error('Usage: upload_manifest --package=pkg1 --package=pkg2 [--no-dry-run]');
  }

  const graph = getPackageGraph();

  // Resolve and validate
  const resolvedPackages = packagesToPublish.map(name => {
    const pkg = Object.values(graph)
      .filter(p => p.dir.includes('/renderers/'))
      .find(p => p.name === name || p.name.endsWith('/' + name));
    if (!pkg) {
      throw new Error(`Package "${name}" not found in renderers directory.`);
    }
    return pkg.name.replace('@a2ui/', '');
  });
  // A manifest to only publish the specified packages.
  const manifest = {
    publish_all: false,
    publishing_groups: [
      {
        namespace: '@a2ui',
        packages: resolvedPackages.map(name => ({name})),
      },
    ],
  };

  const manifestPath = join(ROOT_DIR, 'manifest.json');
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  writeFile(manifestPath, manifestJson);

  console.log(`${bold}Generating manifest.json${reset}`);
  console.info(manifestJson);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // YYYY-MM-DDTHH-mm-ss
  // Find the version of a representative package for the manifest name
  const mainVersion = graph['@a2ui/web_core']?.version;
  if (!mainVersion) {
    throw new Error(
      'Could not find @a2ui/web_core in workspace. Ensure you are running from the correct directory.',
    );
  }
  const manifestFileName = `manifest-${mainVersion}-${timestamp}.json`;

  try {
    const destination = `${GCS_URI}/${manifestFileName}`;

    console.log(`${bold}Uploading manifest to GCS${reset}`);
    console.info('- Destination:', destination);
    maybeRunCommand(
      'gcloud',
      ['storage', 'cp', manifestPath, destination],
      {},
      {dryRun: isDryRun, runCommand: runCmd},
    );
    console.log(`${green}Done.${reset}`);
  } catch (error) {
    throw new Error(
      'Failed to upload manifest. Ensure gcloud is authenticated and you have permissions.',
      {cause: error},
    );
  }
}

// Only run the script if this file is executed directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(err => {
    console.error(`${red}${err.message || err}${reset}`);
    process.exit(1);
  });
}
