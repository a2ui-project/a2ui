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

const SPEC_EXAMPLES_DIR = path.resolve(
  import.meta.dirname,
  '../../../../specification/v0_9/catalogs/basic/examples',
);
const V10_EXAMPLES_DIR = path.resolve(
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
 * example JSON files for v0.9 and v1.0.
 *
 * This allows the React explorer application and integration tests to resolve the
 * spec files dynamically at runtime without relying on Vite-specific APIs like
 * "import.meta.glob", which are unsupported by other standard ES compilers
 * (such as the esbuild preprocessor in our Karma test runner).
 */
function generateExamplesBundle() {
  if (!fs.existsSync(SPEC_EXAMPLES_DIR)) {
    console.error(`Specification directory not found: ${SPEC_EXAMPLES_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(V10_EXAMPLES_DIR)) {
    console.error(`v1.0 examples directory not found: ${V10_EXAMPLES_DIR}`);
    process.exit(1);
  }

  const v09Files = fs
    .readdirSync(SPEC_EXAMPLES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort();

  const v10Files = fs
    .readdirSync(V10_EXAMPLES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort();

  const imports = [];
  const v09Entries = [];
  const v10Entries = [];

  v09Files.forEach((file, index) => {
    const relativePath = `../../../../../specification/v0_9/catalogs/basic/examples/${file}`;
    const variableName = `example_v09_${index}`;

    imports.push(`import ${variableName} from '${relativePath}';`);
    v09Entries.push(`  '${file}': { default: ${variableName} }`);
  });

  v10Files.forEach((file, index) => {
    const relativePath = `../../../../../catalogs/basic/v1/examples/${file}`;
    const variableName = `example_v10_${index}`;

    imports.push(`import ${variableName} from '${relativePath}';`);
    v10Entries.push(`  '${file}': { default: ${variableName} }`);
  });

  EXTRA_EXAMPLES.forEach((extra, index) => {
    const variableName = `extra_example_${index}`;
    imports.push(`import ${variableName} from '${extra.relativePath}';`);
    if (extra.rewritePlaceholderUrl && extra.fixturePath) {
      const rewrittenEntry = `  '${extra.key}': { default: JSON.parse(JSON.stringify(${variableName}).replaceAll(${JSON.stringify(extra.rewritePlaceholderUrl)}, \`\${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}\${${JSON.stringify(extra.fixturePath)}}\`)) }`;
      v09Entries.push(rewrittenEntry);
      v10Entries.push(rewrittenEntry);
    } else {
      v09Entries.push(`  '${extra.key}': { default: ${variableName} }`);
      v10Entries.push(`  '${extra.key}': { default: ${variableName} }`);
    }
  });

  const content = `/**
 * Generated file. Do not edit directly.
 *
 * To regenerate this file, run:
 *   yarn generate-examples
 *
 * Run this command whenever you add, remove, or rename example JSON files
 * in the specification directory.
 */

${imports.join('\n')}

/**
 * Represents the expected structure of the example JSON data.
 * It can be a direct array of messages or an object containing messages and metadata.
 */
export interface ExampleData {
  messages?: unknown[];
  description?: string;
  name?: string;
}

/**
 * Represents the module structure returned by Vite when importing a JSON file
 * via import.meta.glob.
 *
 * The \`default\` property contains the parsed content of the file (in this case,
 * our example data).
 */
export interface ExampleModule {
  default: ExampleData | unknown[];
}

export const exampleModules: Record<string, ExampleModule> = {
${v09Entries.join(',\n')}
} as Record<string, ExampleModule>;

export const EXAMPLES: Record<string, ExampleModule> = exampleModules;

export const exampleModulesV10: Record<string, ExampleModule> = {
${v10Entries.join(',\n')}
} as Record<string, ExampleModule>;

export const EXAMPLES_V10: Record<string, ExampleModule> = exampleModulesV10;
`;

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, {recursive: true});
  }

  fs.writeFileSync(OUT_FILE, content, 'utf-8');
  console.log(`Successfully generated static examples mapping to ${OUT_FILE}`);
}

generateExamplesBundle();
