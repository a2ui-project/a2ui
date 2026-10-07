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

const MCP_EXAMPLES = [
  {
    filePath: '../../../catalogs/mcp/v1/examples/mcp-app-order-summary.json',
    catalog: 'mcp',
  },
  {
    filePath: '../../../catalogs/mcp/v1/examples/mcp-app-sheet-music.json',
    catalog: 'mcp',
  },
  {
    filePath: '../../../catalogs/mcp/v1/examples/mcp-app-3d-geometry.json',
    catalog: 'mcp',
  },
];

const IFRAME_EXAMPLES = [
  {
    filePath: '../../../catalogs/iframe/examples/srcdoc-tip-calculator.json',
    catalog: 'iframe',
  },
  {
    filePath: '../../../catalogs/iframe/examples/url-order-tracker.json',
    catalog: 'iframe',
  },
];

function readExampleFile(filePath, catalog, version) {
  const file = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    const data = JSON.parse(content);
    const nameFromFile = file
      .replace('.json', '')
      .replace(/^[0-9]+_/, '')
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
    const candidateDirs = [
      path.resolve(import.meta.dirname, specPath, catalog, 'examples'),
      path.resolve(import.meta.dirname, specPath, catalog, 'v1', 'examples'),
      path.join(specPath, catalog, 'examples'),
      path.join(specPath, catalog, 'v1', 'examples'),
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

  const examplesV08 = readExamples('../../../specification/v0_8/json/catalogs', catalogs, '0.8');
  const examplesV09 = [
    ...readExamples('../../../specification/v0_9/catalogs', catalogs, '0.9'),
    ...MCP_EXAMPLES.map(({filePath, catalog}) => readExampleFile(filePath, catalog, '0.9')),
    ...IFRAME_EXAMPLES.map(({filePath, catalog}) => readExampleFile(filePath, catalog, '0.9')),
  ];
  const examplesV10 = [
    ...readExamples('../../../../catalogs/basic/v1/examples', catalogs, '1.0'),
    ...MCP_EXAMPLES.map(({filePath, catalog}) => readExampleFile(filePath, catalog, '1.0')),
    ...IFRAME_EXAMPLES.map(({filePath, catalog}) => readExampleFile(filePath, catalog, '1.0')),
  ];

  // Generate the file now!
  const tsContent = `/**
 * Generated file. Do not edit directly.
 */

import { Example, Example_08 } from '../types';

export const EXAMPLES_V08: Example_08[] = JSON.parse(${JSON.stringify(JSON.stringify(examplesV08))});

export const EXAMPLES_V09: Example[] = JSON.parse(
  ${JSON.stringify(JSON.stringify(examplesV09))}.replaceAll(
    'https://example.com/a2ui-apps/order-tracker/',
    \`\${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}/a2ui-fixtures/apps/order_tracker.html\`,
  ),
);

export const EXAMPLES_V10: Example[] = JSON.parse(
  ${JSON.stringify(JSON.stringify(examplesV10))}.replaceAll(
    'https://example.com/a2ui-apps/order-tracker/',
    \`\${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}/a2ui-fixtures/apps/order_tracker.html\`,
  ),
);

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
