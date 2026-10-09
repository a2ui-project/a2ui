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

const SPEC_V09_EXAMPLES_DIR = path.resolve(
  import.meta.dirname,
  '../../../../specification/v0_9/catalogs/basic/examples',
);
const CATALOGS_V10_EXAMPLES_DIR = path.resolve(
  import.meta.dirname,
  '../../../../catalogs/basic/v1/examples',
);
const EXTRA_EXAMPLES = [
  {
    key: 'mcp-app-order-summary.json',
    relativePath: '../../../../../catalogs/mcp/v1/examples/mcp-app-order-summary.json',
  },
  {
    key: 'mcp-app-sheet-music.json',
    relativePath: '../../../../../catalogs/mcp/v1/examples/mcp-app-sheet-music.json',
  },
  {
    key: 'mcp-app-3d-geometry.json',
    relativePath: '../../../../../catalogs/mcp/v1/examples/mcp-app-3d-geometry.json',
  },
  {
    key: 'srcdoc-tip-calculator.json',
    relativePath: '../../../../../catalogs/iframe/examples/srcdoc-tip-calculator.json',
  },
  {
    key: 'url-order-tracker.json',
    relativePath: '../../../../../catalogs/iframe/examples/url-order-tracker.json',
    rewritePlaceholderUrl: 'https://example.com/a2ui-apps/order-tracker/',
    fixturePath: '/a2ui-fixtures/apps/order_tracker.html',
  },
];
const OUT_FILE = path.resolve(import.meta.dirname, '../src/generated/examples-list.ts');

/**
 * Generates a static TypeScript module bundle that imports all the basic catalog
 * example JSON files for both v0.9 and v1.0.
 *
 * This allows the Lit explorer application and integration tests to resolve the
 * spec files dynamically at runtime without relying on Vite-specific APIs like
 * "import.meta.glob", which are unsupported by other standard ES compilers
 * (such as the esbuild preprocessor in our Karma test runner).
 */
function generateExamplesBundle() {
  if (!fs.existsSync(SPEC_V09_EXAMPLES_DIR)) {
    console.error(`v0.9 specification directory not found: ${SPEC_V09_EXAMPLES_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(CATALOGS_V10_EXAMPLES_DIR)) {
    console.error(`v1.0 catalog examples directory not found: ${CATALOGS_V10_EXAMPLES_DIR}`);
    process.exit(1);
  }

  const filesV09 = fs
    .readdirSync(SPEC_V09_EXAMPLES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort();

  const filesV10 = fs
    .readdirSync(CATALOGS_V10_EXAMPLES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort();

  const imports = [];
  const entriesV09 = [];
  const entriesV10 = [];

  filesV09.forEach((file, index) => {
    const relativePath = `../../../../../specification/v0_9/catalogs/basic/examples/${file}`;
    const variableName = `example_v09_${index}`;

    imports.push(`import ${variableName} from '${relativePath}';`);
    entriesV09.push(`  '${file}': { default: ${variableName}, version: '0.9' }`);
  });

  filesV10.forEach((file, index) => {
    const relativePath = `../../../../../catalogs/basic/v1/examples/${file}`;
    const variableName = `example_v10_${index}`;

    imports.push(`import ${variableName} from '${relativePath}';`);
    entriesV10.push(`  '${file}': { default: ${variableName}, version: '1.0' }`);
  });

  EXTRA_EXAMPLES.forEach((extra, index) => {
    const variableName = `extra_example_${index}`;
    imports.push(`import ${variableName} from '${extra.relativePath}';`);
    if (extra.rewritePlaceholderUrl && extra.fixturePath) {
      const rewrittenEntry = `  '${extra.key}': { default: JSON.parse(JSON.stringify(${variableName}).replaceAll(${JSON.stringify(extra.rewritePlaceholderUrl)}, \`\${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}\${${JSON.stringify(extra.fixturePath)}}\`)), version: '1.0' }`;
      entriesV09.push(rewrittenEntry);
      entriesV10.push(rewrittenEntry);
    } else {
      entriesV09.push(`  '${extra.key}': { default: ${variableName}, version: '1.0' }`);
      entriesV10.push(`  '${extra.key}': { default: ${variableName}, version: '1.0' }`);
    }
  });

  const content = `/**
 * Generated file. Do not edit directly.
 *
 * To regenerate this file, run:
 *   yarn generate-examples
 *
 * Run this command whenever you add, remove, or rename example JSON files
 * in the specification or catalogs directories.
 */

import {A2uiMessage} from '@a2ui/web_core/v0_9';
import {AgentToRendererMessage} from '@a2ui/web_core/v1_0';

${imports.join('\n')}

export type ExplorerMessage = A2uiMessage | AgentToRendererMessage;

/**
 * Represents the expected structure of the example JSON data.
 * It can be a direct array of messages or an object containing messages and metadata.
 */
export interface ExampleData {
  messages?: ExplorerMessage[];
  description?: string;
}

/**
 * Represents the module structure returned when importing an example JSON file.
 */
export interface ExampleModule {
  default: ExampleData | ExplorerMessage[];
  version?: '0.9' | '1.0';
}

export const EXAMPLES_V09: Record<string, ExampleModule> = {
${entriesV09.join(',\n')}
} as Record<string, ExampleModule>;

export const EXAMPLES_V10: Record<string, ExampleModule> = {
${entriesV10.join(',\n')}
} as Record<string, ExampleModule>;

export const EXAMPLES: Record<string, ExampleModule> = EXAMPLES_V09;
export const exampleModules: Record<string, ExampleModule> = EXAMPLES_V09;
`;

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, {recursive: true});
  }

  fs.writeFileSync(OUT_FILE, content, 'utf-8');
  console.log(`Successfully generated static examples mapping to ${OUT_FILE}`);
}

generateExamplesBundle();
