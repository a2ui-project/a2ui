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

/**
 * Emits TypeScript types from the published JSON Schema documents: for each
 * protocol version, its common types (`generated-common-types.ts`, from
 * `common_types.json`), and for each basic catalog, one exported
 * `<Component>Props` interface per component, with bindings typed as the
 * common types of the catalog's own protocol version.
 *
 * The catalogs themselves are loaded from the same documents at runtime
 * (`createBasicCatalog`); these types only give renderers typed props.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..', '..', '..');

const HEADER = `/*
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
`;

/**
 * The common types to emit, one module per protocol version, from that
 * version's `common_types.json`.
 */
export const COMMON_TYPES = [
  {source: 'specification/v0_9/json/common_types.json', dest: 'src/v0_9/generated-common-types.ts'},
  {source: 'specification/v1_0/json/common_types.json', dest: 'src/v1_0/generated-common-types.ts'},
];

/**
 * The catalogs to emit props types for: source document, destination file,
 * and the common types module of the catalog's protocol version (v0.8 has
 * none: its catalog spells its bindings out).
 */
export const CATALOGS = [
  {
    source: 'specification/v0_8/json/standard_catalog_definition.json',
    dest: 'src/v0_8/basic_catalog/generated-types.ts',
  },
  {
    source: 'specification/v0_9/catalogs/basic/catalog.json',
    dest: 'src/v0_9/basic_catalog/generated-types.ts',
    commonTypes: 'src/v0_9/generated-common-types.ts',
  },
  {
    source: 'catalogs/basic/v1/catalog.json',
    dest: 'src/catalogs/basic/v1/generated-types.ts',
    commonTypes: 'src/v1_0/generated-common-types.ts',
  },
];

/** The local definitions of a catalog that are not props types. */
const SKIPPED_DEFS = new Set(['anyComponent', 'anyFunction']);

/**
 * The type a common types document's references into the catalog
 * (`catalog.json#/$defs/<name>`) stand for, which no catalog-independent
 * type can spell out further.
 */
const CATALOG_REFS = {
  anyFunction: 'CatalogFunctionCall',
  anyComponent: 'CatalogComponent',
};

/** Names that props of the common types module use besides its definitions. */
const COMPONENT_COMMON_PROPS = 'ComponentCommonProps';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function quoteKey(key) {
  return IDENTIFIER.test(key) ? key : `'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function literal(value) {
  return JSON.stringify(value).replace(/"/g, "'");
}

function comment(text, indent) {
  if (typeof text !== 'string' || text.trim() === '') return '';
  const lines = text.replace(/\*\//g, '*\\/').split('\n');
  return `${indent}/**\n${lines.map(line => `${indent} * ${line}`.trimEnd()).join('\n')}\n${indent} */\n`;
}

/**
 * The name a `$ref` resolves to, recording common type imports.
 *
 * @throws {Error} For a reference the generator has no type for, such as a
 *   common type its version does not define.
 */
function refName(ref, ctx) {
  const hash = ref.indexOf('#');
  const document = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? '' : ref.slice(hash);
  const match = /^#\/\$defs\/([^/]+)$/.exec(pointer);
  if (!match) throw new Error(`${ctx.source}: unsupported $ref '${ref}'.`);
  const name = match[1];
  const local = document === '' || document.endsWith('catalog.json');
  if (ctx.mode === 'common') {
    if (document === '' && ctx.localDefs.has(name)) return name;
    if (document.endsWith('catalog.json') && Object.hasOwn(CATALOG_REFS, name)) {
      ctx.catalogRefs.add(name);
      return CATALOG_REFS[name];
    }
    throw new Error(`${ctx.source}: unmapped $ref '${ref}'.`);
  }
  if (local && ctx.localDefs.has(name)) return name;
  // A common type, by its own document's name or, as catalogs written against
  // the common types' names do, by a local name the catalog does not define.
  if (document.endsWith('common_types.json') || (local && !ctx.localDefs.has(name))) {
    const typeName = name === 'ComponentCommon' ? COMPONENT_COMMON_PROPS : name;
    if (ctx.commonNames.has(typeName)) {
      ctx.imports.add(typeName);
      return typeName;
    }
  }
  throw new Error(`${ctx.source}: unmapped common_types $ref '${ref}'.`);
}

function objectBody(schema, ctx, indent, omit = new Set()) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  let body = '';
  for (const [key, value] of Object.entries(properties)) {
    if (omit.has(key)) continue;
    body += comment(value?.description, indent);
    body += `${indent}${quoteKey(key)}${required.has(key) ? '' : '?'}: ${typeOf(value, ctx, indent)};\n`;
  }
  const additional = schema.additionalProperties;
  if (additional && typeof additional === 'object') {
    body += `${indent}[key: string]: ${typeOf(additional, ctx, indent)};\n`;
  }
  return body;
}

/** The TypeScript type of a JSON Schema node. */
function typeOf(schema, ctx, indent = '') {
  if (schema === true || schema === undefined) return 'unknown';
  if (schema === false) return 'never';
  if (typeof schema.$ref === 'string' && !schema.allOf) return refName(schema.$ref, ctx);
  if ('const' in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(' | ');
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) {
      const union = schema[key].map(member => `(${typeOf(member, ctx, indent)})`).join(' | ');
      // An object that declares properties beside the union has them on every branch.
      if (!schema.properties) return union;
      const own = typeOf({...schema, [key]: undefined}, ctx, indent);
      return `(${own}) & (${union})`;
    }
  }
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map(member => typeOf(member, ctx, indent));
    if (schema.properties) parts.push(typeOf({...schema, allOf: undefined}, ctx, indent));
    // A member that only constrains (such as a `format`) adds no type.
    const typed = parts.filter(part => part !== 'unknown');
    if (typed.length === 0) return 'unknown';
    return typed.length === 1 ? typed[0] : typed.map(part => `(${part})`).join(' & ');
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    return type.map(t => typeOf({...schema, type: t}, ctx, indent)).join(' | ');
  }
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${typeOf(schema.items, ctx, indent)}>`;
    case 'object':
    default:
      if (
        schema.properties ||
        (schema.additionalProperties && typeof schema.additionalProperties === 'object')
      ) {
        return `{\n${objectBody(schema, ctx, `${indent}  `)}${indent}}`;
      }
      return type === 'object' ? 'Record<string, unknown>' : 'unknown';
  }
}

/**
 * An interface declaration for an object schema: its `allOf` references
 * become `extends` clauses and its own (and inline `allOf` members')
 * properties its members. `undefined` if the schema is not such an object.
 */
function interfaceOf(name, schema, ctx, omit) {
  const bases = [];
  const own = [];
  const members = [schema, ...(Array.isArray(schema.allOf) ? schema.allOf : [])];
  for (const member of members) {
    if (member === schema) {
      if (schema.properties) own.push(schema);
      continue;
    }
    if (typeof member?.$ref === 'string' && Object.keys(member).length === 1) {
      const base = refName(member.$ref, ctx);
      bases.push(base);
    } else if (
      member &&
      typeof member === 'object' &&
      (member.properties || member.type === 'object')
    ) {
      own.push(member);
    } else {
      return undefined;
    }
  }
  if (bases.length === 0 && own.length === 0 && schema.type !== 'object') return undefined;
  const body = own.map(member => objectBody(member, ctx, '  ', omit)).join('');
  const extendsClause = bases.length > 0 ? ` extends ${bases.join(', ')}` : '';
  return `export interface ${name}${extendsClause} {\n${body}}\n`;
}

const GENERATED_NOTE = `// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY`;

/**
 * The note on what the generated types describe: values as a message writes
 * them. The runtime may fill in a schema's \`default\`s, so a resolved value
 * can carry a property its input type marks optional.
 */
const INPUT_SHAPE_NOTE = `/**
 * These types describe values as a message writes them (the input shape of
 * the schemas). The defaults the schemas declare are filled in at runtime,
 * so a validated value may carry a property its type marks optional.
 */
`;

/** The generated common types module of one protocol version. */
export function generateCommonTypes(doc, sourcePath) {
  const defs = doc.$defs ?? {};
  const ctx = {
    mode: 'common',
    source: sourcePath,
    imports: new Set(),
    catalogRefs: new Set(),
    localDefs: new Set(Object.keys(defs)),
  };
  let out = '';
  for (const [name, schema] of Object.entries(defs)) {
    out += comment(schema?.description, '');
    out += `export type ${name} = ${typeOf(schema, ctx)};\n\n`;
  }
  let prelude = '';
  if (ctx.catalogRefs.has('anyFunction')) {
    prelude +=
      '/** A call of a function of the catalog the call runs in (`catalog.json#/$defs/anyFunction`). */\n' +
      'export type CatalogFunctionCall = {\n  args?: Record<string, unknown>;\n};\n\n';
  }
  if (ctx.catalogRefs.has('anyComponent')) {
    prelude +=
      '/** A component of the catalog (`catalog.json#/$defs/anyComponent`). */\n' +
      'export type CatalogComponent = Record<string, unknown>;\n\n';
  }
  if (Object.hasOwn(defs, 'ComponentCommon')) {
    out +=
      "/**\n * The properties of `ComponentCommon` a component's props carry: all but the\n" +
      ' * envelope fields (`id`, `@catalogId`), which route the component.\n */\n' +
      `export type ${COMPONENT_COMMON_PROPS} = Omit<ComponentCommon, 'id' | '@catalogId'>;\n`;
  }
  return (
    `${HEADER}\n${GENERATED_NOTE}\n` +
    `// Generated from ${sourcePath} via scripts/generate-basic-catalog-types.mjs\n\n` +
    INPUT_SHAPE_NOTE +
    '\n' +
    prelude +
    out
  );
}

/** The type names a generated common types module exports. */
export function commonTypeNames(doc) {
  const names = new Set(Object.keys(doc.$defs ?? {}));
  if (names.has('ComponentCommon')) names.add(COMPONENT_COMMON_PROPS);
  return names;
}

/**
 * The generated props types module for one catalog document.
 *
 * @param doc The catalog document.
 * @param sourcePath Its path, for the header and errors.
 * @param commonNames The type names of its version's common types module.
 */
export function generateTypes(doc, sourcePath, commonNames = new Set()) {
  const defs = doc.$defs ?? {};
  const ctx = {
    mode: 'catalog',
    source: sourcePath,
    imports: new Set(),
    commonNames,
    localDefs: new Set(Object.keys(defs).filter(name => !SKIPPED_DEFS.has(name))),
  };
  let out = '';
  for (const name of ctx.localDefs) {
    const schema = defs[name];
    out += comment(schema?.description, '');
    const typeName = name === 'theme' ? 'Theme' : name;
    out +=
      interfaceOf(typeName, schema, ctx, new Set()) ??
      `export type ${typeName} = ${typeOf(schema, ctx)};\n`;
    out += '\n';
  }
  if (doc.styles && typeof doc.styles === 'object') {
    out += '/** The theme of the catalog (`styles`). */\n';
    out += `export interface Theme {\n${objectBody({properties: doc.styles}, ctx, '  ')}}\n\n`;
  }
  for (const [name, schema] of Object.entries(doc.components ?? {})) {
    out += `/** The props of the \`${name}\` component. */\n`;
    out +=
      interfaceOf(`${name}Props`, schema, ctx, new Set(['component'])) ??
      `export type ${name}Props = ${typeOf(schema, ctx)};\n`;
    out += '\n';
  }
  out += '/** The props types of the catalog, by component name. */\n';
  out += 'export interface BasicCatalogProps {\n';
  for (const name of Object.keys(doc.components ?? {}))
    out += `  ${quoteKey(name)}: ${name}Props;\n`;
  out += '}\n';

  const imports = [...ctx.imports].sort();
  const importLine =
    imports.length > 0 ? `import type {${imports.join(', ')}} from '__COMMON_TYPES__';\n\n` : '';
  return (
    `${HEADER}\n${GENERATED_NOTE}\n` +
    `// Generated from ${sourcePath} via scripts/generate-basic-catalog-types.mjs\n\n` +
    importLine +
    INPUT_SHAPE_NOTE +
    '\n' +
    out
  );
}

/** A module specifier from `fromFile` to the `.js` of the `.ts` file `toFile`. */
function specifier(fromFile, toFile) {
  let path = relative(dirname(fromFile), toFile).replace(/\.ts$/, '.js');
  if (!path.startsWith('.')) path = `./${path}`;
  return path;
}

function main() {
  const readDoc = source => JSON.parse(readFileSync(join(repo, source), 'utf8'));
  const commonNamesByDest = new Map();
  for (const {source, dest} of COMMON_TYPES) {
    const doc = readDoc(source);
    writeFileSync(join(root, dest), generateCommonTypes(doc, source));
    commonNamesByDest.set(dest, commonTypeNames(doc));
    console.log(`Generated ${dest}`);
  }
  for (const {source, dest, commonTypes} of CATALOGS) {
    const destPath = join(root, dest);
    const names = commonTypes ? commonNamesByDest.get(commonTypes) : new Set();
    let out = generateTypes(readDoc(source), source, names);
    if (commonTypes)
      out = out.replace('__COMMON_TYPES__', specifier(destPath, join(root, commonTypes)));
    writeFileSync(destPath, out);
    console.log(`Generated ${dest}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
