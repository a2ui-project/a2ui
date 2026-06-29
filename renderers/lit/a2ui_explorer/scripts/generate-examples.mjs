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

import fs from 'fs';
import path from 'path';

const SPEC_EXAMPLES_DIR = path.resolve(
  import.meta.dirname,
  '../../../../specification/v0_9_1/catalogs/basic/examples',
);
const OUT_FILE = path.resolve(import.meta.dirname, '../src/generated/examples-list.ts');

/**
 * Generates a static TypeScript module bundle that imports all the basic catalog
 * example JSON files.
 *
 * This allows the Lit explorer application and integration tests to resolve the
 * spec files dynamically at runtime without relying on Vite-specific APIs like
 * "import.meta.glob", which are unsupported by other standard ES compilers
 * (such as the esbuild preprocessor in our Karma test runner).
 */
function generateExamplesBundle() {
  if (!fs.existsSync(SPEC_EXAMPLES_DIR)) {
    console.error(`Specification directory not found: ${SPEC_EXAMPLES_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(SPEC_EXAMPLES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort();

  const imports = [];
  const entries = [];

  files.forEach((file, index) => {
    // Relative path from src/generated/examples-list.ts to the specification examples folder
    const relativePath = `../../../../../specification/v0_9_1/catalogs/basic/examples/${file}`;
    const variableName = `example_${index}`;

    imports.push(`import ${variableName} from '${relativePath}';`);
    entries.push(`  '${file}': { default: ${variableName} }`);
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

// Cast is required because JSON imports infer 'version' as 'string' instead of literal '"v0.9"'.
export const exampleModules: Record<string, ExampleModule> = {
${entries.join(',\n')}
} as Record<string, ExampleModule>;
`;

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, {recursive: true});
  }

  fs.writeFileSync(OUT_FILE, content, 'utf-8');
  console.log(`Successfully generated static examples mapping to ${OUT_FILE}`);
}

generateExamplesBundle();
