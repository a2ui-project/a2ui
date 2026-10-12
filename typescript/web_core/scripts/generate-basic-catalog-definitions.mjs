/*
 * Copyright 2026 Google LLC
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
 * @fileoverview Generates the catalog definitions of the built-in basic
 * catalogs from their published catalog documents.
 *
 * For each basic catalog, writes a TypeScript module with:
 *
 * - `BASIC_CATALOG_DOCUMENT_OPTIONS`: the document-level fields of the
 *   published document (`CatalogDocumentOptions`).
 * - `BASIC_COMPONENT_DEFINITIONS`: each component's definition as published.
 * - `BASIC_FUNCTION_DEFINITIONS`: each function's definition as published.
 *
 * The built-in catalogs attach these definitions to their entries, so that
 * `Catalog.toJson` assembles the published document from the catalog's model
 * without reading the JSON file at runtime. The fields are read exactly as
 * `Catalog.fromJson` reads them (see `readDocumentFields` in
 * src/catalog/schema_loader.ts).
 *
 * Run with `yarn generate-zod-schemas` (or `node scripts/generate-basic-catalog-definitions.mjs`
 * followed by Prettier).
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webCoreDir = join(__dirname, '..');
const repoRoot = resolve(webCoreDir, '..', '..');

const HEADER = `/*
 * Copyright 2026 Google LLC
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
// Generated via scripts/generate-basic-catalog-definitions.mjs
`;

/** The basic catalogs, their published documents and their generated modules. */
const CATALOGS = [
  {
    label: 'v0.8',
    source: 'specification/v0_8/json/standard_catalog_definition.json',
    output: 'src/v0_8/basic_catalog/catalog_definitions.ts',
    typesImportPath: '../../catalog/types.js',
  },
  {
    label: 'v0.9',
    source: 'specification/v0_9/catalogs/basic/catalog.json',
    output: 'src/v0_9/basic_catalog/catalog_definitions.ts',
    typesImportPath: '../../catalog/types.js',
  },
  {
    label: 'v1',
    source: 'catalogs/basic/v1/catalog.json',
    output: 'src/catalogs/basic/v1/catalog_definitions.ts',
    typesImportPath: '../../../catalog/types.js',
  },
];

/** Top-level string keys of a catalog document and the fields they map to. */
const DOCUMENT_STRING_FIELDS = {
  '$schema': 'schemaUri',
  '$id': 'schemaId',
  'title': 'title',
  'description': 'description',
  'instructions': 'instructions',
};

/** Top-level keys the catalog models besides the string fields. */
const DOCUMENT_STRUCTURE_FIELDS = new Set(['protocolVersion', 'catalogId', 'components']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function escapePointer(token) {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function componentUnion(names) {
  const oneOf = names.map(name => ({$ref: `#/components/${escapePointer(name)}`}));
  return oneOf.length === 0 ? {not: {}} : {oneOf, discriminator: {propertyName: 'component'}};
}

function functionUnion(names) {
  const oneOf = names.map(name => ({$ref: `#/functions/${escapePointer(name)}`}));
  return oneOf.length === 0 ? {not: {}} : {oneOf};
}

/**
 * Returns the names a union's `oneOf` lists under `prefix`, or `undefined`
 * when it lists none, as the schema loader's `extractPermittedNames` does.
 */
function permittedNames(union, prefix) {
  if (!isPlainObject(union) || !Array.isArray(union.oneOf)) return undefined;
  return new Set(
    union.oneOf
      .map(item => (typeof item?.$ref === 'string' ? item.$ref : ''))
      .filter(ref => ref.startsWith(prefix))
      .map(ref => ref.slice(prefix.length).replace(/~1/g, '/').replace(/~0/g, '~')),
  );
}

/** Returns the entries of a section, by name, that the schema loader loads. */
function loadedEntries(document, section, unionName) {
  const raw = document[section];
  const entries = Array.isArray(raw)
    ? raw
        .filter(item => isPlainObject(item) && typeof item.name === 'string')
        .map(item => [item.name, item])
    : isPlainObject(raw)
      ? Object.entries(raw).filter(([, definition]) => isPlainObject(definition))
      : [];
  const permitted = permittedNames(document.$defs?.[unionName], `#/${section}/`);
  return Object.fromEntries(entries.filter(([name]) => !permitted || permitted.has(name)));
}

/** Reads the document-level fields as `Catalog.fromJson` reads them. */
function documentFields(document, componentNames, functionNames) {
  const fields = {};
  const extensionFields = {};
  for (const [key, value] of Object.entries(document)) {
    if (key in DOCUMENT_STRING_FIELDS && typeof value === 'string') {
      fields[DOCUMENT_STRING_FIELDS[key]] = value;
    } else if (key === 'protocolVersion' && typeof value === 'string') {
      fields.declaredProtocolVersion = value;
    } else if (key === 'functions' && (Array.isArray(value) || isPlainObject(value))) {
      fields.functionsLayout = Array.isArray(value) ? 'list' : 'map';
    } else if (key === '$defs' && isPlainObject(value)) {
      const anyComponent =
        canonicalJson(value.anyComponent) === canonicalJson(componentUnion(componentNames));
      const anyFunction =
        canonicalJson(value.anyFunction) === canonicalJson(functionUnion(functionNames));
      fields.unions = {anyComponent, anyFunction};
      fields.defs = Object.fromEntries(
        Object.entries(value).filter(
          ([name]) =>
            !((name === 'anyComponent' && anyComponent) || (name === 'anyFunction' && anyFunction)),
        ),
      );
    } else if (
      !DOCUMENT_STRUCTURE_FIELDS.has(key) ||
      (key === 'components' && !isPlainObject(value))
    ) {
      extensionFields[key] = value;
    }
  }
  fields.declaredProtocolVersion ??= null;
  fields.declaresCatalogId = typeof document.catalogId === 'string';
  fields.unions ??= {anyComponent: false, anyFunction: false};
  if (Object.keys(extensionFields).length > 0) fields.extensionFields = extensionFields;
  return fields;
}

/**
 * Renders the definitions module of one basic catalog.
 *
 * @param catalog An entry of `CATALOGS`.
 * @param document The published catalog document.
 * @returns The module source, before formatting.
 */
export function renderCatalogDefinitions(catalog, document) {
  const components = loadedEntries(document, 'components', 'anyComponent');
  const functions = loadedEntries(document, 'functions', 'anyFunction');
  const fields = documentFields(document, Object.keys(components), Object.keys(functions));
  return `${HEADER}
import type {CatalogDocumentOptions, JsonSchemaObject} from '${catalog.typesImportPath}';

/**
 * The document-level fields of the published ${catalog.label} basic catalog
 * (${catalog.source}).
 */
export const BASIC_CATALOG_DOCUMENT_OPTIONS: CatalogDocumentOptions = ${JSON.stringify(fields, null, 2)};

/**
 * The definitions of the ${catalog.label} basic catalog's components, by name,
 * as published.
 */
export const BASIC_COMPONENT_DEFINITIONS: Readonly<Record<string, JsonSchemaObject>> = ${JSON.stringify(components, null, 2)};

/**
 * The definitions of the ${catalog.label} basic catalog's functions, by name,
 * as published.
 */
export const BASIC_FUNCTION_DEFINITIONS: Readonly<Record<string, JsonSchemaObject>> = ${JSON.stringify(functions, null, 2)};
`;
}

for (const catalog of CATALOGS) {
  const document = JSON.parse(readFileSync(join(repoRoot, catalog.source), 'utf8'));
  writeFileSync(join(webCoreDir, catalog.output), renderCatalogDefinitions(catalog, document));
  console.log(`Generated ${catalog.output} from ${catalog.source}.`);
}
