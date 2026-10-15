/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Generates the component models of the v0.8 basic catalog.
 *
 * A v0.8 catalog document has no common types: every property is written
 * inline. Each component becomes a strict Zod object, annotated (see
 * src/catalog/spec_annotations.ts) with what the document writes that Zod
 * does not express, so that `Catalog.toJson` computes the published document
 * from the models. The `styles` theme becomes `ThemeSchema`.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  annotationFor,
  escapeStr,
  generateObjectNode,
  literal,
} from '../../../scripts/generate-catalog-schemas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const v08Dir = join(__dirname, '..');
const rootDir = join(v08Dir, '..', '..', '..', '..', '..');
const catalogPath = join(
  rootDir,
  'specification',
  'v0_8',
  'json',
  'standard_catalog_definition.json',
);
const outPath = join(v08Dir, 'basic_catalog', 'components', 'basic_components.ts');

const HEADER = `/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/v0_8/json/standard_catalog_definition.json via
// src/v0_8/scripts/generate-catalog.mjs
`;

/**
 * Generates a strict object model and its annotation.
 *
 * @param {object} schema The object's schema.
 * @param {object} ctx Generation context.
 * @param {object} [extra] Annotation entries to add.
 */
function strictObject(schema, ctx, extra = {}) {
  const node = generateObjectNode(schema, ctx, '    ');
  let code = node.code;
  const prediction = {...node.prediction, additionalProperties: false};
  if (schema.description) {
    code += `.describe('${escapeStr(schema.description)}')`;
    prediction.description = schema.description;
  }
  code += '.strict()';
  // A strict object whose schema writes no closure, such as the theme.
  const open = schema.additionalProperties === undefined;
  if (open) delete prediction.additionalProperties;
  const annotation = {
    ...extra,
    ...(open ? {closure: 'none'} : {}),
    ...annotationFor(schema, prediction),
  };
  return Object.keys(annotation).length > 0 ? `spec(${code}, ${literal(annotation)})` : code;
}

console.log('Generating v0.8 Basic Catalog APIs...');

const catalogJson = JSON.parse(readFileSync(catalogPath, 'utf8'));
// The document has no references, so no common types are written.
const ctx = {commonDefs: {}, usedImports: new Set(), commonTypesUri: ''};

let out = HEADER;
out += `import {z} from 'zod';

import {spec} from '../../../catalog/spec_annotations.js';
import {CatalogDocumentOptions, ComponentApi} from '../../../catalog/types.js';

`;

const apiNames = [];
for (const [name, schema] of Object.entries(catalogJson.components)) {
  const apiName = `${name}Api`;
  apiNames.push(apiName);
  // Every component is annotated, with no mixins, which marks it as one whose
  // definition `toJson` computes.
  out += `export const ${apiName} = {
  name: '${name}',
  schema: ${strictObject(schema, ctx, {mixins: []})},
} satisfies ComponentApi;

`;
}

out += `/**
 * The theme of the v0.8 basic catalog, which its document declares under
 * \`styles\`.
 */
export const ThemeSchema = ${strictObject({type: 'object', properties: catalogJson.styles}, ctx)};

export const BASIC_COMPONENTS: ComponentApi[] = [
${apiNames.map(name => `  ${name},`).join('\n')}
];

/**
 * The document-level fields of the published catalog document, which
 * declares neither a protocol version nor a catalog ID, writes its theme
 * under \`styles\` and has no \`$defs\`.
 */
export const BASIC_CATALOG_DOCUMENT_OPTIONS = {
  declaredProtocolVersion: null,
  declaresCatalogId: false,
  unions: {anyComponent: false, anyFunction: false},
  themeLocation: 'styles',
} satisfies CatalogDocumentOptions;
`;

writeFileSync(outPath, out);

console.log('Successfully generated v0.8 Basic Catalog APIs.');
