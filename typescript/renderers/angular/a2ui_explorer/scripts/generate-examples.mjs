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

import fs from 'fs';
import path from 'path';
import {parseArgs} from 'node:util';

/**
 * The default output file path where the generated examples bundle will be written.
 */
const DEFAULT_OUT_FILE = 'src/app/generated/examples-bundle.ts';

/**
 * The default catalogs to generate examples for if none are specified.
 */
const DEFAULT_CATALOGS = ['basic'];

/**
 * The options that this script accepts.
 */
const options = {
  help: {type: 'boolean', short: 'h'},
  'out-file': {type: 'string', short: 'o', default: DEFAULT_OUT_FILE},
  catalog: {type: 'string', short: 'c', multiple: true, default: DEFAULT_CATALOGS},
};

/**
 * The help message that is displayed when the -h or --help flag is used.
 */
const HELP_MESSAGE = `Usage: node generate-examples.mjs [options]

Options:
  -o, --out-file <path>   Output file path (default: ${DEFAULT_OUT_FILE})
  -c, --catalog <name>   Catalog names to include (can be specified multiple times) (default: ${DEFAULT_CATALOGS.join(', ')})
  -h, --help             Show this help message
`;

const EXAMPLE_ORDER = [
  'scaffold-simple-text.json',
  'scaffold-row-layout.json',
  'scaffold-interactive-button.json',
  'scaffold-simple-login-form.json',
  'scaffold-complex-layout.json',
  'scaffold-formatted-text.json',
  'scaffold-incremental.json',
  'flight-status.json',
  'email-compose.json',
  'calendar-day.json',
  'weather-current.json',
  'product-card.json',
  'music-player.json',
  'task-card.json',
  'user-profile.json',
  'login-form.json',
  'notification-permission.json',
  'purchase-complete.json',
  'chat-message.json',
  'coffee-order.json',
  'sports-player.json',
  'account-balance.json',
  'workout-summary.json',
  'event-detail.json',
  'track-list.json',
  'software-purchase.json',
  'restaurant-card.json',
  'shipping-status.json',
  'credit-card.json',
  'step-counter.json',
  'recipe-card.json',
  'contact-card.json',
  'podcast-episode.json',
  'stats-card.json',
  'countdown-timer.json',
  'movie-card.json',
  'modal-sample.json',
  'live-invitation-builder.json',
  'incremental-dashboard.json',
  'advanced-form-validator.json',
  'financial-data-grid.json',
  'child-list-template.json',
  'markdown-text.json',
  'modal.json',
  'native-grid.json',
  'mcp-app-3d-geometry.json',
];

const EXAMPLE_ORDER_INDEX = new Map(EXAMPLE_ORDER.map((name, index) => [name, index]));

function compareExampleFilenames(a, b) {
  const indexA = EXAMPLE_ORDER_INDEX.get(a);
  const indexB = EXAMPLE_ORDER_INDEX.get(b);
  if (indexA !== undefined && indexB !== undefined) {
    return indexA - indexB;
  }
  if (indexA !== undefined) return -1;
  if (indexB !== undefined) return 1;
  return a.localeCompare(b);
}

const MCP_EXAMPLES = [
  {
    filePath: '../../../../catalogs/mcp/v1/examples/mcp-app-3d-geometry.json',
    catalog: 'mcp',
  },
];

function readExampleFile(filePath, catalog, version) {
  const file = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    const data = JSON.parse(content);
    const nameFromFile = file
      .replace('.json', '')
      .replace(/^(?:scaffold-|[0-9]+_)/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());

    if (Array.isArray(data)) {
      return {
        filename: file,
        version: version,
        name: version === '0.8' ? `${nameFromFile} (${catalog})` : nameFromFile,
        description: `Example from ${catalog} catalog`,
        messages: data,
      };
    }
    return {
      ...data,
      filename: file,
      version: version,
      name:
        version === '0.8' ? `${data.name || nameFromFile} (${catalog})` : data.name || nameFromFile,
      description: data.description || `Example from ${catalog} catalog`,
      messages: data.messages || [],
    };
  } catch (e) {
    throw new Error(`Error parsing ${filePath}`, {cause: e});
  }
}

/**
 * Reads examples for a given version and catalogs.
 */
function readExamples(specPath, catalogs, version) {
  const examples = [];

  for (const catalog of catalogs) {
    const versionSubdir = version === '0.9' ? 'v0_9' : 'v1';
    const candidateDirs = [
      path.resolve(import.meta.dirname, specPath, catalog, 'examples'),
      path.resolve(import.meta.dirname, specPath, catalog, versionSubdir, 'examples'),
      path.join(specPath, catalog, 'examples'),
      path.join(specPath, catalog, versionSubdir, 'examples'),
      path.resolve(import.meta.dirname, specPath),
      specPath,
    ];
    const examplesDir = candidateDirs.find(d => fs.existsSync(d));
    if (examplesDir) {
      const files = fs
        .readdirSync(examplesDir)
        .filter(f => f.endsWith('.json'))
        .sort();
      for (const file of files) {
        const filePath = path.join(examplesDir, file);
        examples.push(readExampleFile(filePath, catalog, version));
      }
    }
  }
  return examples;
}

/**
 * Main execution function for the script.
 * Parses arguments, reads catalog examples, and generates the TypeScript bundle.
 */
async function main() {
  const {values} = parseArgs({options, allowNegative: true});

  if (values.help) {
    console.log(HELP_MESSAGE);
    return;
  }

  const outPath = values['out-file'];
  const outDir = path.dirname(outPath);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, {recursive: true});
  }

  const catalogs = values.catalog;

  const examplesV08 = readExamples(
    '../../../../specification/v0_8/json/catalogs',
    catalogs,
    '0.8',
  ).sort((a, b) => compareExampleFilenames(a.filename, b.filename));
  const examplesV09 = [
    ...readExamples('../../../../catalogs', catalogs, '0.9'),
    ...MCP_EXAMPLES.map(({filePath, catalog}) => readExampleFile(filePath, catalog, '0.9')),
  ].sort((a, b) => compareExampleFilenames(a.filename, b.filename));
  const examplesV10 = [
    ...readExamples('../../../../../catalogs/basic/v1/examples', catalogs, '1.0'),
    ...MCP_EXAMPLES.map(({filePath, catalog}) => readExampleFile(filePath, catalog, '1.0')),
  ].sort((a, b) => compareExampleFilenames(a.filename, b.filename));

  // Generate the file now!
  const tsContent = `/**
 * Generated file. Do not edit directly.
 */

import { Example, Example_08 } from '../types';

export const EXAMPLES_V08: Example_08[] = JSON.parse(${JSON.stringify(JSON.stringify(examplesV08))});

export const EXAMPLES_V09: Example[] = JSON.parse(${JSON.stringify(JSON.stringify(examplesV09))});

export const EXAMPLES_V10: Example[] = JSON.parse(${JSON.stringify(JSON.stringify(examplesV10))});

// Defaults to v0.9
export const EXAMPLES: Example[] = EXAMPLES_V09;
`;

  fs.writeFileSync(outPath, tsContent);
  console.log(`Generated examples to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
