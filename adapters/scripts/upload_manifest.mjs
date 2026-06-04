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

const {yellow, red, green, reset} = ansi;

/**
 * Generates and uploads the npm manifest to GCS.
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
  };

  const {values} = parseArgs({args, options, allowNegative: true});
  const packagesToPublish = values.package;
  const isDryRun = values['dry-run'];

  const graph = getPackageGraph();

  let manifest;

  if (packagesToPublish.length > 0) {
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
    manifest = {
      publish_all: false,
      publishing_groups: [
        {
          namespace: '@a2ui',
          packages: resolvedPackages.map(name => ({name})),
        },
      ],
    };
  } else {
    // A manifest to publish all packages.
    manifest = {
      publish_all: true,
    };
  }

  const manifestPath = join(ROOT_DIR, 'manifest.json');
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  writeFile(manifestPath, manifestJson);

  console.log('--- Generated manifest.json:');
  console.log(manifestJson);

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
    console.log(`--- Uploading manifest to GCS: ${GCS_URI}/${manifestFileName}`);
    maybeRunCommand(
      'gcloud',
      ['storage', 'cp', manifestPath, `${GCS_URI}/${manifestFileName}`],
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
