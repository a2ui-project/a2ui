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

import {readFileSync, writeFileSync, readdirSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const specDir = join(rootDir, '..', '..', 'specification');
const destFile = join(rootDir, 'src', 'types', 'common-types.ts');

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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/*/json/common_types.json via scripts/generate-superset-common-types.mjs

/**
 * @fileoverview Shared runtime types and helper schemas for A2UI rendering
 * engines.
 *
 * Defines unversioned, internal types, schemas, and helper utilities consumed
 * by shared runtime modules (such as GenericBinder, DataContext,
 * ExpressionParser, and SchemaLoader).
 *
 * This module represents the runtime superset of the modern protocol lineage
 * (v0.9 and above), aligned with the most recent dynamic value evaluation
 * model. Version-isolated wire validation and catalog schemas are maintained
 * separately in src/v<version>/ directories, e.g. src/v1_0/.
 */
`;

function escapeStr(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function getLatestDescription(schemas) {
  const descriptions = schemas.map(s => s.description).filter(Boolean);
  return descriptions.length > 0 ? descriptions[descriptions.length - 1] : undefined;
}

function mergeUnionSchemas(schemas) {
  const branches = [];
  const seen = new Set();
  for (const s of schemas) {
    const items = s.oneOf || s.anyOf || [s];
    for (let item of items) {
      if (
        item &&
        Array.isArray(item.allOf) &&
        item.allOf.length === 2 &&
        item.allOf[0].$ref &&
        item.allOf[1].properties
      ) {
        item = {$ref: item.allOf[0].$ref};
      }
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        branches.push(JSON.parse(JSON.stringify(item)));
      }
    }
  }
  return {oneOf: branches};
}

function collectAllPropertyNames(schemas) {
  const names = new Set();
  for (const s of schemas) {
    if (s.properties) {
      Object.keys(s.properties).forEach(p => names.add(p));
    }
  }
  return names;
}

function findRequiredInAllProperties(schemas, propNames) {
  const required = [];
  for (const prop of propNames) {
    const isRequiredEverywhere = schemas.every(
      s => !s.properties || !s.properties[prop] || (s.required && s.required.includes(prop)),
    );
    if (isRequiredEverywhere && schemas.some(s => s.required && s.required.includes(prop))) {
      required.push(prop);
    }
  }
  return required;
}

function mergeObjectSchemas(schemas) {
  const merged = {type: 'object', properties: {}};
  const propNames = collectAllPropertyNames(schemas);

  for (const prop of propNames) {
    const propSchemas = schemas.map(s => s.properties && s.properties[prop]).filter(Boolean);
    merged.properties[prop] = deepMergeSchemas(propSchemas);
  }

  const required = findRequiredInAllProperties(schemas, propNames);
  if (required.length > 0) {
    merged.required = required;
  }
  return merged;
}

function mergeEnumSchemas(schemas) {
  const enumValues = new Set();
  for (const s of schemas) {
    if (Array.isArray(s.enum)) {
      s.enum.forEach(v => enumValues.add(v));
    }
  }
  return {type: 'string', enum: Array.from(enumValues)};
}

/**
 * Deep merges a list of JSON Schema definitions across versions into a superset schema.
 *
 * @param {Array<object>} schemas List of schema objects in chronological order.
 * @returns {object} The merged superset JSON Schema.
 */
function deepMergeSchemas(schemas) {
  if (!schemas || schemas.length === 0) return {};
  if (schemas.length === 1) return JSON.parse(JSON.stringify(schemas[0]));

  const description = getLatestDescription(schemas);
  let merged;

  if (schemas.some(s => s.oneOf || s.anyOf)) {
    merged = mergeUnionSchemas(schemas);
  } else if (schemas.every(s => s.type === 'object' || s.properties)) {
    merged = mergeObjectSchemas(schemas);
  } else if (schemas.some(s => Array.isArray(s.enum))) {
    merged = mergeEnumSchemas(schemas);
  } else {
    merged = Object.assign({}, ...schemas);
  }

  if (description) {
    merged.description = description;
  }
  return merged;
}

// 1. Discover all version directories containing common_types.json (excluding legacy v0.8)
const versionDirs = readdirSync(specDir)
  .filter(d => d !== 'v0_8' && existsSync(join(specDir, d, 'json', 'common_types.json')))
  .sort();

console.log(`Discovered specification versions: ${versionDirs.join(', ')}`);

const allDefsByVersion = versionDirs.map(v => {
  const json = JSON.parse(readFileSync(join(specDir, v, 'json', 'common_types.json'), 'utf8'));
  return {version: v, defs: json.$defs || {}};
});

const allDefNames = new Set();
for (const {defs} of allDefsByVersion) {
  for (const name of Object.keys(defs)) {
    allDefNames.add(name);
  }
}

const mergedDefs = {};
for (const name of allDefNames) {
  const versionsWithDef = allDefsByVersion.map(v => v.defs[name]).filter(Boolean);
  mergedDefs[name] = deepMergeSchemas(versionsWithDef);
}

// 2. Build dependency graph and compute topological order
function getDependencies(node, deps = new Set()) {
  if (!node || typeof node !== 'object') return deps;
  if (Array.isArray(node)) {
    node.forEach(child => getDependencies(child, deps));
    return deps;
  }
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
    deps.add(node.$ref.replace('#/$defs/', ''));
  }
  for (const val of Object.values(node)) {
    getDependencies(val, deps);
  }
  return deps;
}

function analyzeDependencies(defs) {
  const graph = new Map();
  for (const [name, def] of Object.entries(defs)) {
    graph.set(name, getDependencies(def));
  }

  const visiting = new Set();
  const visited = new Set();
  const topologicalOrder = [];
  const lazyEdges = new Set();

  function visit(node) {
    if (visited.has(node) || visiting.has(node)) return;

    visiting.add(node);
    for (const dep of graph.get(node) || []) {
      if (visiting.has(dep)) {
        lazyEdges.add(`${node}->${dep}`);
      } else if (!visited.has(dep) && graph.has(dep)) {
        visit(dep);
      }
    }
    visiting.delete(node);
    visited.add(node);
    topologicalOrder.push(node);
  }

  for (const name of graph.keys()) {
    visit(name);
  }

  return {topologicalOrder, lazyEdges};
}

const {topologicalOrder, lazyEdges} = analyzeDependencies(mergedDefs);
const recursiveSchemas = new Set([
  ...Array.from(lazyEdges).map(e => e.split('->')[0]),
  ...Array.from(lazyEdges).map(e => e.split('->')[1]),
]);

function generateRefZod(refString, parentDefName, lazyEdges, topologicalOrder) {
  if (refString.startsWith('https://') || refString.startsWith('http://')) {
    return 'z.record(z.string(), z.any())';
  }
  const idx = refString.indexOf('#/$defs/');
  if (idx === -1) return null;
  const targetName = refString.substring(idx + 8);
  if (targetName === 'anyFunction') {
    return 'z.record(z.string(), z.any())';
  }
  if (
    lazyEdges &&
    (lazyEdges.has(`${parentDefName}->${targetName}`) ||
      (topologicalOrder &&
        topologicalOrder.indexOf(targetName) > topologicalOrder.indexOf(parentDefName)))
  ) {
    return `z.lazy(() => ${targetName}Schema)`;
  }
  return `${targetName}Schema`;
}

function generateUnionZod(schema, parentDefName, indent, lazyEdges, topologicalOrder) {
  const branches = (schema.oneOf || schema.anyOf).map(b =>
    generateZod(b, parentDefName, indent + '  ', lazyEdges, topologicalOrder),
  );
  let code = `z.union([\n${branches.map(b => `${indent}  ${b},`).join('\n')}\n${indent}])`;
  if (schema.description) {
    code += `.describe('${escapeStr(schema.description)}')`;
  }
  return code;
}

function generateAllOfZod(schema, parentDefName, indent, lazyEdges, topologicalOrder) {
  if (schema.allOf.length === 2 && schema.allOf[0].$ref && schema.allOf[1].properties) {
    return generateRefZod(schema.allOf[0].$ref, parentDefName, lazyEdges, topologicalOrder);
  }
  const branches = schema.allOf.map(b =>
    generateZod(b, parentDefName, indent, lazyEdges, topologicalOrder),
  );
  return branches.join('.and(') + ')'.repeat(branches.length - 1);
}

function generateEnumZod(schema) {
  let code = `z.enum([${schema.enum.map(e => `'${escapeStr(e)}'`).join(', ')}])`;
  if (schema.default !== undefined) {
    code += `.default('${escapeStr(schema.default)}')`;
  }
  if (schema.description) {
    code += `.describe('${escapeStr(schema.description)}')`;
  }
  return code;
}

function generateLiteralZod(schema) {
  let code = `z.literal('${escapeStr(schema.const)}')`;
  if (schema.description) {
    code += `.describe('${escapeStr(schema.description)}')`;
  }
  return code;
}

function generatePrimitiveZod(schema) {
  let code;
  if (schema.type === 'string') {
    code = 'z.string()';
    if (schema.default !== undefined) code += `.default('${escapeStr(schema.default)}')`;
  } else if (schema.type === 'number') {
    code = 'z.number()';
    if (schema.default !== undefined) code += `.default(${schema.default})`;
  } else if (schema.type === 'integer') {
    code = 'z.number().int()';
    if (schema.default !== undefined) code += `.default(${schema.default})`;
  } else if (schema.type === 'boolean') {
    code = 'z.boolean()';
    if (schema.default !== undefined) code += `.default(${schema.default})`;
  } else {
    return null;
  }
  if (schema.description) {
    code += `.describe('${escapeStr(schema.description)}')`;
  }
  return code;
}

function generateArrayZod(schema, parentDefName, indent, lazyEdges, topologicalOrder) {
  const itemCode = generateZod(schema.items, parentDefName, indent, lazyEdges, topologicalOrder);
  let code = `z.array(${itemCode})`;
  if (schema.minItems !== undefined) code += `.min(${schema.minItems})`;
  if (schema.description) code += `.describe('${escapeStr(schema.description)}')`;
  return code;
}

function generateObjectZod(schema, parentDefName, indent, lazyEdges, topologicalOrder) {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    let code = 'z.record(z.string(), z.any())';
    if (schema.description) code += `.describe('${escapeStr(schema.description)}')`;
    return code;
  }

  const req = new Set(schema.required || []);
  const props = [];
  for (const [propName, propDef] of Object.entries(schema.properties)) {
    let propZod = generateZod(propDef, parentDefName, indent + '  ', lazyEdges, topologicalOrder);
    if (!req.has(propName)) {
      propZod += '.optional()';
    }
    props.push(`${indent}  '${propName}': ${propZod},`);
  }

  let code = `z.object({\n${props.join('\n')}\n${indent}})`;
  if (schema.unevaluatedProperties === false || schema.additionalProperties === false) {
    code += '.strict()';
  }
  if (schema.description) {
    code += `.describe('${escapeStr(schema.description)}')`;
  }
  return code;
}

/**
 * Generates clean TypeScript Zod code directly from a JSON Schema node.
 */
function generateZod(schema, parentDefName, indent = '', lazyEdges, topologicalOrder) {
  if (!schema || typeof schema !== 'object') {
    return 'z.any()';
  }
  if (typeof schema.$ref === 'string') {
    const refCode = generateRefZod(schema.$ref, parentDefName, lazyEdges, topologicalOrder);
    if (refCode) return refCode;
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    return generateUnionZod(schema, parentDefName, indent, lazyEdges, topologicalOrder);
  }
  if (Array.isArray(schema.allOf)) {
    return generateAllOfZod(schema, parentDefName, indent, lazyEdges, topologicalOrder);
  }
  if (Array.isArray(schema.enum)) {
    return generateEnumZod(schema);
  }
  if (schema.const !== undefined) {
    return generateLiteralZod(schema);
  }
  const primCode = generatePrimitiveZod(schema);
  if (primCode) {
    return primCode;
  }
  if (schema.type === 'array') {
    return generateArrayZod(schema, parentDefName, indent, lazyEdges, topologicalOrder);
  }
  if (schema.type === 'object' || schema.properties) {
    return generateObjectZod(schema, parentDefName, indent, lazyEdges, topologicalOrder);
  }
  return 'z.any()';
}

let outTs = HEADER;
outTs += `import {z} from 'zod';
import {markChildRef} from './child-ref-helpers.js';

`;

const defKeys = [
  ...topologicalOrder.filter(k => k in mergedDefs),
  ...Object.keys(mergedDefs).filter(k => !topologicalOrder.includes(k)),
];

const generatedSchemaNames = [];

for (const name of defKeys) {
  const rawDef = JSON.parse(JSON.stringify(mergedDefs[name]));
  const desc = rawDef.description
    ? `REF:common_types.json#/$defs/${name}|${escapeStr(rawDef.description)}`
    : `REF:common_types.json#/$defs/${name}`;
  rawDef.description = desc;

  let zodCode;
  if (name === 'ComponentId') {
    zodCode = `markChildRef(
  z.string().describe('${desc}'),
  'component-id',
)`;
  } else if (name === 'ChildList') {
    zodCode = `markChildRef(
  z.union([
    z.array(ComponentIdSchema).describe('A static list of child component IDs.'),
    z.object({
      'componentId': ComponentIdSchema,
      'path': z.string().describe('The path to the list of component property objects in the data model.'),
    }).describe('A template for generating a dynamic list of children.'),
  ]).describe('${desc}'),
  'child-list',
)`;
  } else if (name === 'Extensions') {
    zodCode = `z.record(z.string(), z.any()).describe("Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.")`;
  } else {
    zodCode = generateZod(rawDef, name, '', lazyEdges, topologicalOrder);
    if (name === 'DynamicValue') {
      zodCode = zodCode.replace(
        'z.record(z.string(), z.any())',
        "z.record(z.string(), z.any()).refine(obj => !obj || (!('path' in obj) && !('call' in obj)))",
      );
    }
  }

  if (recursiveSchemas.has(name)) {
    outTs += `export const ${name}Schema: z.ZodType<any> = ${zodCode};\n`;
  } else {
    outTs += `export const ${name}Schema = ${zodCode};\n`;
  }

  if (rawDef.description) {
    outTs += `/** ${rawDef.description.replace(/\n/g, ' ')} */\n`;
  }
  outTs += `export type ${name} = z.infer<typeof ${name}Schema>;\n\n`;
  generatedSchemaNames.push(name);

  if (name === 'DataBinding') {
    outTs += `export type DataBindingType = DataBinding;\n\n`;
  }
  if (name === 'FunctionCall') {
    outTs += `export type FunctionCallType = FunctionCall;\n\n`;
  }
}

// CommonSchemas registry map
outTs += `/**
 * Registry of reusable common schema definitions across A2UI catalogs and protocols.
 */
export const CommonSchemas = {
`;

for (const name of generatedSchemaNames) {
  outTs += `  ${name}: ${name}Schema,\n`;
}
outTs += `};\n\n`;
outTs += `export * from './helpers.js';\n`;

writeFileSync(destFile, outTs);
console.log(`Successfully generated superset common types in ${destFile}`);
