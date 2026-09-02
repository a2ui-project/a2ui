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
    const items = s.oneOf || [s];
    for (const item of items) {
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

  if (schemas.some(s => s.oneOf)) {
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

const graph = new Map();
for (const [name, def] of Object.entries(mergedDefs)) {
  const deps = getDependencies(def);
  if (name === 'FunctionCall') {
    deps.delete('DynamicValue');
    deps.delete('IndexSystemFunction');
  }
  if (name === 'DynamicValue') {
    deps.delete('FunctionCall');
  }
  graph.set(name, deps);
}

const visited = new Set();
const topologicalOrder = [];

function visit(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const deps = graph.get(name) || new Set();
  for (const dep of deps) {
    if (graph.has(dep)) {
      visit(dep);
    }
  }
  topologicalOrder.push(name);
}

for (const name of graph.keys()) {
  visit(name);
}

function generateRefZod(refString, parentDefName) {
  const idx = refString.indexOf('#/$defs/');
  if (idx === -1) return null;
  const targetName = refString.substring(idx + 8);
  if (targetName === 'anyFunction') {
    return 'z.record(z.any())';
  }
  if (parentDefName === 'DynamicValue' && targetName === 'FunctionCall') {
    return 'FunctionCallSchema';
  }
  return `${targetName}Schema`;
}

function generateUnionZod(schema, parentDefName, indent) {
  const branches = (schema.oneOf || schema.anyOf).map(b =>
    generateZod(b, parentDefName, indent + '  '),
  );
  let code = `z.union([\n${branches.map(b => `${indent}  ${b},`).join('\n')}\n${indent}])`;
  if (schema.description) {
    code += `.describe('${escapeStr(schema.description)}')`;
  }
  return code;
}

function generateAllOfZod(schema, parentDefName, indent) {
  if (schema.allOf.length === 2 && schema.allOf[0].$ref && schema.allOf[1].properties) {
    const baseName = schema.allOf[0].$ref.replace('#/$defs/', '');
    return `${baseName}Schema`;
  }
  const branches = schema.allOf.map(b => generateZod(b, parentDefName, indent));
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

function generateArrayZod(schema, parentDefName, indent) {
  const itemCode = generateZod(schema.items, parentDefName, indent);
  let code = `z.array(${itemCode})`;
  if (schema.minItems !== undefined) code += `.min(${schema.minItems})`;
  if (schema.description) code += `.describe('${escapeStr(schema.description)}')`;
  return code;
}

function generateObjectZod(schema, parentDefName, indent) {
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    let code = 'z.record(z.string(), z.any())';
    if (schema.description) code += `.describe('${escapeStr(schema.description)}')`;
    return code;
  }

  const req = new Set(schema.required || []);
  const props = [];
  for (const [propName, propDef] of Object.entries(schema.properties)) {
    let propZod = generateZod(propDef, parentDefName, indent + '  ');
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
function generateZod(schema, parentDefName, indent = '') {
  if (!schema || typeof schema !== 'object') {
    return 'z.any()';
  }
  if (typeof schema.$ref === 'string') {
    const refCode = generateRefZod(schema.$ref, parentDefName);
    if (refCode) return refCode;
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    return generateUnionZod(schema, parentDefName, indent);
  }
  if (Array.isArray(schema.allOf)) {
    return generateAllOfZod(schema, parentDefName, indent);
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
    return generateArrayZod(schema, parentDefName, indent);
  }
  if (schema.type === 'object' || schema.properties) {
    return generateObjectZod(schema, parentDefName, indent);
  }
  return 'z.any()';
}

let outTs = HEADER;
outTs += `import {z} from 'zod';
import {
  type ChildRefKind,
  type RefSchemaOptions,
  markChildRef,
  childRefKindOf,
} from './child-ref-helpers.js';

export {
  type ChildRefKind,
  type RefSchemaOptions,
  markChildRef,
  childRefKindOf,
};

`;

const defKeys = [
  ...topologicalOrder.filter(k => k in mergedDefs),
  ...Object.keys(mergedDefs).filter(k => !topologicalOrder.includes(k)),
];

const generatedSchemaNames = [];

for (const name of defKeys) {
  const rawDef = mergedDefs[name];
  let zodCode = generateZod(rawDef, name);

  // Apply special-case transforms
  if (name === 'DynamicValue') {
    zodCode = `z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    z.record(z.string(), z.any()).refine(obj => !obj || (!('path' in obj) && !('call' in obj))),
    DataBindingSchema,
    FunctionCallSchema,
  ]).describe('REF:common_types.json#/$defs/DynamicValue|A value that can be a literal, a path, or a function call returning any type.')`;
  } else if (name === 'ComponentId') {
    zodCode = `markChildRef(
  z.string().describe('REF:common_types.json#/$defs/ComponentId|The unique identifier for a component.'),
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
  ]).describe('REF:common_types.json#/$defs/ChildList'),
  'child-list',
)`;
  } else if (name === 'Extensions') {
    zodCode = `z.record(z.string(), z.any()).describe("Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.")`;
  } else if (name === 'DataBinding') {
    zodCode = `z.object({
  'path': z.string().describe('A JSON Pointer path to a value in the data model.'),
}).describe('REF:common_types.json#/$defs/DataBinding|A JSON Pointer path to a value in the data model.')`;
  } else if (name === 'FunctionCall') {
    zodCode = `z.object({
  'call': z.string().describe('The name of the function to call.'),
  'catalogId': z.string().optional().describe('The ID of the catalog containing the function.'),
  'args': z.record(z.any()).optional().describe('Arguments passed to the function.'),
  'returnType': z
    .enum(['string', 'number', 'boolean', 'array', 'object', 'validationResult', 'any', 'void'])
    .optional(),
}).describe('REF:common_types.json#/$defs/FunctionCall|Invokes a named function on the client.')`;
  } else if (name === 'DynamicString') {
    zodCode = `z.union([z.string(), DataBindingSchema, FunctionCallSchema]).describe('REF:common_types.json#/$defs/DynamicString|Represents a dynamic string value.')`;
  } else if (name === 'DynamicNumber') {
    zodCode = `z.union([z.number(), DataBindingSchema, FunctionCallSchema]).describe('REF:common_types.json#/$defs/DynamicNumber|Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.')`;
  } else if (name === 'DynamicBoolean') {
    zodCode = `z.union([z.boolean(), DataBindingSchema, FunctionCallSchema]).describe('REF:common_types.json#/$defs/DynamicBoolean|A boolean value that can be a literal, a path, or a function call returning a boolean.')`;
  } else if (name === 'DynamicStringList') {
    zodCode = `z.union([z.array(z.string()), DataBindingSchema, FunctionCallSchema]).describe('REF:common_types.json#/$defs/DynamicStringList|Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.')`;
  } else if (name === 'Action') {
    zodCode = `z.union([
    z.object({
      'event': z.object({
        'name': z.string(),
        'context': z.record(DynamicValueSchema).optional(),
      }),
    }).describe('Triggers a server-side event.'),
    z.object({
      'functionCall': FunctionCallSchema,
    }).describe('Executes a local client-side function.'),
  ]).describe('REF:common_types.json#/$defs/Action|Triggers a server-side event or a local client-side function.')`;
  } else if (name === 'CheckRule') {
    zodCode = `z.object({
  'condition': DynamicBooleanSchema,
  'message': z.string().describe('The error message to display if the check fails.'),
}).describe('REF:common_types.json#/$defs/CheckRule|A check rule consisting of a condition and an error message.')`;
  } else if (name === 'Checkable') {
    zodCode = `z.object({
  'checks': z.array(CheckRuleSchema).optional().describe('A list of checks to perform.'),
  'isValid': z.boolean().optional().describe('Whether the checks currently pass.'),
  'validationErrors': z.array(z.string()).optional().describe('Current validation error messages.'),
}).describe('REF:common_types.json#/$defs/Checkable|Properties for components that support client-side checks.')`;
  } else if (name === 'AccessibilityAttributes') {
    zodCode = `z.object({
  'label': DynamicStringSchema.optional().describe('A short string used by assistive technologies to convey the purpose of an element.'),
  'description': DynamicStringSchema.optional().describe('Additional information provided by assistive technologies about an element.'),
  'live': z.enum(['off', 'polite', 'assertive']).describe("Controls screen reader announcements for dynamic updates (WAI-ARIA aria-live). 'polite' waits for user pause; 'assertive' interrupts immediately for alerts.").default('off').optional(),
  'hidden': DynamicBooleanSchema.optional().describe('Controls whether assistive technologies hide the element.'),
}).describe('REF:common_types.json#/$defs/AccessibilityAttributes|Attributes to enhance accessibility.')`;
  }

  outTs += `export const ${name}Schema = ${zodCode};\n`;
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

// Helper functions
outTs += `/**
 * Creates or customizes a ComponentId schema without losing its reference pointer metadata.
 *
 * @param options Configuration options including custom description.
 * @returns The configured ComponentId schema.
 */
export function componentId(options: RefSchemaOptions = {}): typeof ComponentIdSchema {
  if (options.description === undefined) {
    return ComponentIdSchema;
  }
  return ComponentIdSchema.describe(
    \`REF:common_types.json#/$defs/ComponentId|\${options.description}\`,
  );
}

/**
 * Creates or customizes a ChildList schema without losing its reference pointer metadata.
 *
 * @param options Configuration options including custom description.
 * @returns The configured ChildList schema.
 */
export function childList(options: RefSchemaOptions = {}): typeof ChildListSchema {
  if (options.description === undefined) {
    return ChildListSchema;
  }
  return ChildListSchema.describe(\`REF:common_types.json#/$defs/ChildList|\${options.description}\`);
}

/**
 * Generic component definition payload schema.
 */
export const AnyComponentSchema = z
  .object({
    'component': z.string().describe('The type name of the component.'),
    'id': ComponentIdSchema.optional(),
    'weight': z.number().optional(),
  })
  .passthrough()
  .describe('A generic A2UI component definition.');

/** Generic component definition payload. */
export type AnyComponent = z.infer<typeof AnyComponentSchema>;

`;

// CommonSchemas registry map
outTs += `/**
 * Registry of reusable common schema definitions across A2UI catalogs and protocols.
 */
export const CommonSchemas = {
`;

for (const name of generatedSchemaNames) {
  outTs += `  ${name}: ${name}Schema,\n`;
}
outTs += `  AnyComponent: AnyComponentSchema,\n`;
outTs += `};\n`;

writeFileSync(destFile, outTs);
console.log(`Successfully generated superset common types in ${destFile}`);
