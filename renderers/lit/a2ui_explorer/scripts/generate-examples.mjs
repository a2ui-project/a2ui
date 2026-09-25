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

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const OUT_FILE = path.resolve(import.meta.dirname, '../src/generated/examples-list.ts');

/**
 * The example directories the explorer lists, in this order. `catalog` is the label the explorer
 * shows next to the examples of a directory; `dir` is relative to the repository root.
 */
const EXAMPLE_SOURCES = [
  {catalog: 'basic', dir: 'specification/v0_9/catalogs/basic/examples'},
  {catalog: 'iframe', dir: 'catalogs/iframe/examples'},
  {catalog: 'mcp', dir: 'catalogs/mcp/examples'},
];

/**
 * Generates a static TypeScript module bundle that imports all the example JSON
 * files of the basic, iframe and MCP catalogs.
 *
 * This allows the Lit explorer application and integration tests to resolve the
 * spec files dynamically at runtime without relying on Vite-specific APIs like
 * "import.meta.glob", which are unsupported by other standard ES compilers
 * (such as the esbuild preprocessor in our Karma test runner).
 */
function generateExamplesBundle() {
  const imports = [];
  const entries = [];

  for (const {catalog, dir} of EXAMPLE_SOURCES) {
    const examplesDir = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(examplesDir)) {
      console.error(`Examples directory not found: ${examplesDir}`);
      process.exit(1);
    }

    const files = fs
      .readdirSync(examplesDir)
      .filter(file => file.endsWith('.json'))
      .sort();

    files.forEach((file, index) => {
      // Relative path from src/generated/examples-list.ts to the examples folder
      const relativePath = `../../../../../${dir}/${file}`;
      const variableName = `${catalog}_${index}`;

      imports.push(`import ${variableName} from '${relativePath}';`);
      entries.push(
        `  {catalog: '${catalog}', filename: '${file}', module: {default: ${variableName}}}`,
      );
    });
  }

  const content = `/**
 * Generated file. Do not edit directly.
 *
 * To regenerate this file, run:
 *   yarn generate-examples
 *
 * Run this command whenever you add, remove, or rename example JSON files
 * in the catalog examples directories.
 */

import {A2uiMessage} from '@a2ui/web_core/v0_9';

${imports.join('\n')}

/**
 * Represents the expected structure of the example JSON data.
 * It can be a direct array of messages or an object containing messages and metadata.
 */
export interface ExampleData {
  messages?: A2uiMessage[];
  description?: string;
}

/**
 * Represents the module structure returned by Vite when importing a JSON file
 * via import.meta.glob.
 *
 * The \`default\` property contains the parsed content of the file (in this case,
 * our example data).
 */
export interface ExampleModule {
  default: ExampleData | A2uiMessage[];
}

/** An example JSON file together with the catalog it belongs to. */
export interface ExampleEntry {
  /** Label of the catalog whose examples directory the file was read from. */
  catalog: string;
  /** Name of the JSON file. */
  filename: string;
  module: ExampleModule;
}

// Cast is required because JSON imports infer 'version' as 'string' instead of literal '"v0.9"'.
/** Every example, grouped by catalog and sorted by filename within a catalog. */
export const exampleEntries: ExampleEntry[] = [
${entries.join(',\n')},
] as ExampleEntry[];
`;

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, {recursive: true});
  }

  fs.writeFileSync(OUT_FILE, content, 'utf-8');
  console.log(`Successfully generated static examples mapping to ${OUT_FILE}`);
}

generateExamplesBundle();
