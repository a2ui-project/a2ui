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

import {readFileSync, writeFileSync} from 'node:fs';

/**
 * @fileoverview Schema-driven catalog code generator.
 *
 * Generates TypeScript ComponentApi and FunctionApi definitions directly from
 * specification JSON Schemas without hardcoded property lists or wrapper types.
 *
 * The generator resolves $ref pointers (local and cross-file) and merges allOf
 * inheritance branches into flat property dictionaries. Referenced definitions
 * from common_types.json are resolved dynamically without hardcoding schema names,
 * and component properties are annotated with REF markers to allow runtime schema
 * reconstruction and definition pruning.
 *
 * The generated models also carry what the catalog document writes that Zod
 * does not express, so that `Catalog.toJson` can compute the published
 * document from them (see src/catalog/spec_shape.ts): `spec()` annotations
 * with the mixins each component composes, object closures, `required` order
 * and keywords such as `format`, descriptions on the component schemas,
 * `specDef()` models of the catalog's own definitions (such as
 * `CatalogComponentCommon` and the theme), and the scalar document-level
 * fields. For every node, the generator predicts the JSON Schema the shaper
 * derives from the Zod code it emits, and annotates the node with the
 * difference to the published schema, failing when the difference cannot be
 * expressed.
 */

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
// Generated from specification/ catalogs via scripts/generate-catalog-schemas.mjs
`;

/**
 * Escapes a string for single-quoted JS literals.
 */
export function escapeStr(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/**
 * Converts a function name to a PascalCase identifier, stripping @ and delimiter characters.
 */
export function toPascalCase(name) {
  const cleanName = name.startsWith('@') ? name.substring(1) : name;
  return cleanName
    .replace(/[-_./]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/^[a-z]/, c => c.toUpperCase());
}

/**
 * Resolves a $ref pointer to its definition name (e.g. "#/$defs/DynamicString" -> "DynamicString").
 */
export function extractRefName(ref) {
  if (typeof ref !== 'string') return null;
  const defIdx = ref.indexOf('#/$defs/');
  if (defIdx !== -1) {
    return ref.substring(defIdx + 8);
  }
  const slashIdx = ref.lastIndexOf('/');
  if (slashIdx !== -1) {
    return ref.substring(slashIdx + 1);
  }
  return ref;
}

/**
 * Finds the first matching definition in a list of schemas.
 */
export function findInSchemaList(schemas, commonDefs) {
  if (!Array.isArray(schemas)) return null;
  for (const s of schemas) {
    const name = findReferencedDefName(s, commonDefs);
    if (name) return name;
  }
  return null;
}

/**
 * Finds any referenced definition name inside $ref, allOf, or oneOf.
 */
export function findReferencedDefName(schema, commonDefs) {
  if (!schema || typeof schema !== 'object') return null;
  if (typeof schema.$ref === 'string') {
    const name = extractRefName(schema.$ref);
    if (name && commonDefs[name]) return name;
  }
  return findInSchemaList(schema.allOf, commonDefs);
}

/**
 * Returns a JSON value as a JS expression, with identifier keys unquoted.
 */
export function literal(value) {
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) =>
        `${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)}: ${literal(item)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Attaches default values and descriptions to a Zod code string.
 */
function addDefaultAndDescription(baseCode, propSchema) {
  let code = baseCode;
  if (propSchema.default !== undefined) {
    code +=
      typeof propSchema.default === 'string'
        ? `.default('${escapeStr(propSchema.default)}')`
        : `.default(${propSchema.default})`;
  }
  if (propSchema.description) {
    code += `.describe('${escapeStr(propSchema.description)}')`;
  }
  return code;
}

/**
 * Attaches default values, descriptions and optionality to a Zod code string.
 */
export function applyModifiers(baseCode, propSchema, isRequired) {
  const code = addDefaultAndDescription(baseCode, propSchema);
  return isRequired ? code : `${code}.optional()`;
}

/**
 * Generates Zod code for primitive schemas.
 */
export function generatePrimitiveZod(propSchema) {
  if (propSchema.type === 'string') return 'z.string()';
  if (propSchema.type === 'integer') return 'z.number().int()';
  if (propSchema.type === 'number') return 'z.number()';
  if (propSchema.type === 'boolean') return 'z.boolean()';
  return null;
}

/**
 * The JSON Schema the shaper derives from a primitive's Zod code.
 */
function primitivePrediction(propSchema) {
  return {type: propSchema.type};
}

/**
 * Generation context: the common types definitions, the imports used so far
 * and, when the generated models must reproduce the document, how the
 * document writes the common types document in references.
 *
 * @typedef {{commonDefs: object, usedImports: Set<string>, commonTypesUri?: string}} GenContext
 */

/**
 * Generates the Zod code of a JSON Schema node, without its optionality, and
 * the JSON Schema the shaper derives from that code.
 *
 * @param {object} schema The node.
 * @param {GenContext} ctx Generation context.
 * @param {boolean} [isRequired] Whether the node is a required property, which
 *     a schema that accepts anything must refine to reject `undefined`.
 * @returns {{code: string, prediction: object}}
 */
function generateNode(schema, ctx, isRequired = true) {
  const {commonDefs, usedImports} = ctx;
  const desc = schema.description;
  const describe = prediction => (desc ? {...prediction, description: desc} : prediction);

  // 1. Schema-driven $ref resolution via common_types $defs
  const defName = findReferencedDefName(schema, commonDefs);
  if (defName) {
    usedImports.add(`${defName}Schema`);
    const marker = desc ? `REF:#/$defs/${defName}|${escapeStr(desc)}` : `REF:#/$defs/${defName}`;
    return {
      code: `${defName}Schema.describe('${marker}')`,
      prediction: describe({$ref: `${ctx.commonTypesUri}#/$defs/${defName}`}),
    };
  }

  // 1b. Schema-driven $ref resolution via catalog-local $defs
  const localDefName =
    typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')
      ? extractRefName(schema.$ref)
      : null;
  if (localDefName && ctx.catalogDefs && ctx.catalogDefs[localDefName]) {
    if (ctx.referencedCatalogDefs) {
      ctx.referencedCatalogDefs.add(localDefName);
    }
    if (ctx.commonTypesUri !== undefined) {
      const modelName = defModelName(localDefName);
      const code = desc ? `${modelName}.describe('${escapeStr(desc)}')` : modelName;
      return {
        code,
        prediction: describe({$ref: `#/$defs/${localDefName}`}),
      };
    }
    const inlined = {...ctx.catalogDefs[localDefName], ...schema};
    delete inlined.$ref;
    return generateNode(inlined, ctx, isRequired);
  }

  // 2. OneOf / AnyOf unions
  const unionBranches = schema.oneOf || schema.anyOf;
  if (Array.isArray(unionBranches) && unionBranches.length > 0) {
    const branches = unionBranches.map(branch => annotatedNode(branch, ctx));
    const unionCode =
      branches.length === 1
        ? branches[0].code
        : `z.union([${branches.map(b => b.code).join(', ')}])`;
    const prediction =
      branches.length === 1 ? branches[0].prediction : {oneOf: branches.map(b => b.prediction)};
    return withModifiers(unionCode, prediction, schema);
  }

  // 3. Arrays
  if (schema.type === 'array') {
    const {code, prediction} = generateArrayNode(schema, ctx);
    return withModifiers(code, prediction, schema);
  }

  // 4. Enums
  if (Array.isArray(schema.enum)) {
    const enumCode = `z.enum([${schema.enum.map(v => `'${v}'`).join(', ')}])`;
    return withModifiers(enumCode, {type: 'string', enum: [...schema.enum]}, schema);
  }

  // 5. Primitive types
  const primCode = generatePrimitiveZod(schema);
  if (primCode) {
    const pattern =
      schema.type === 'string' && typeof schema.pattern === 'string'
        ? `.regex(new RegExp(${literal(schema.pattern)}))`
        : '';
    const prediction = primitivePrediction(schema);
    if (pattern) prediction.pattern = schema.pattern;
    return withModifiers(primCode + pattern, prediction, schema);
  }

  // 6. Objects
  if (schema.type === 'object') {
    const {code, prediction} = generateObjectNode(schema, ctx);
    return withModifiers(code, prediction, schema);
  }

  // Generic fallback
  const fallback = isRequired ? "z.any().refine(v => v !== undefined, 'Required')" : 'z.any()';
  return {
    code: desc ? `${fallback}.describe('${escapeStr(desc)}')` : fallback,
    prediction: describe({}),
  };
}

/**
 * Adds a node's default and description to its code and prediction.
 */
export function withModifiers(code, prediction, schema) {
  const result = {...prediction};
  if (schema.description) result.description = schema.description;
  if (schema.default !== undefined) result.default = schema.default;
  return {code: addDefaultAndDescription(code, schema), prediction: result};
}

/**
 * Generates the Zod code and prediction of an array node.
 */
function generateArrayNode(schema, ctx) {
  const items = schema.items;
  let item = {code: 'z.any()', prediction: {}};
  if (items) {
    if (
      findReferencedDefName(items, ctx.commonDefs) ||
      (ctx.catalogDefs && findReferencedDefName(items, ctx.catalogDefs))
    ) {
      item = annotatedNode(items, ctx);
    } else if (items.type === 'string' && !Array.isArray(items.enum)) {
      item = annotatedNode(items, ctx, {code: 'z.string()', prediction: {type: 'string'}});
    } else if (items.type === 'boolean') {
      item = annotatedNode(items, ctx, {code: 'z.boolean()', prediction: {type: 'boolean'}});
    } else if (Array.isArray(items.enum)) {
      item = annotatedNode(items, ctx, {
        code: `z.enum([${items.enum.map(v => `'${v}'`).join(', ')}])`,
        prediction: {type: 'string', enum: [...items.enum]},
      });
    } else if (items.type === 'number' || items.type === 'integer') {
      item = annotatedNode(items, ctx, {code: 'z.number()', prediction: {type: 'number'}});
    } else if (items.type === 'object' && items.properties) {
      item = annotatedNode(items, ctx, generateObjectNode(items, ctx));
    }
  }
  let code = `z.array(${item.code})`;
  const prediction = {type: 'array', items: item.prediction};
  if (schema.minItems !== undefined) {
    code += `.min(${schema.minItems})`;
    prediction.minItems = schema.minItems;
  }
  return {code, prediction};
}

/**
 * Generates the Zod code and prediction of an object node with child
 * properties, without its own annotation.
 */
export function generateObjectNode(schema, ctx, indent = '      ') {
  if (!schema.properties) {
    return {code: 'z.record(z.any())', prediction: {type: 'object', additionalProperties: {}}};
  }
  const objProps = [];
  const properties = {};
  const required = [];
  const itemReq = schema.required || [];
  for (const [subKey, subSchema] of Object.entries(schema.properties)) {
    const isRequired = itemReq.includes(subKey);
    const node = annotatedNode(subSchema, ctx, generateNode(subSchema, ctx, isRequired));
    objProps.push(`${indent}'${subKey}': ${isRequired ? node.code : `${node.code}.optional()`}`);
    properties[subKey] = node.prediction;
    if (isRequired) required.push(subKey);
  }
  const prediction = {type: 'object', properties};
  if (required.length > 0) prediction.required = required;
  return {
    code: `z.object({\n${objProps.join(',\n')},\n${indent.substring(2)}})`,
    prediction,
  };
}

/** Keywords that close an object schema. */
const CLOSURE_KEYWORDS = ['additionalProperties', 'unevaluatedProperties'];

/**
 * Returns the annotation that makes the shaper derive `actual` from code whose
 * derivation is `prediction`, or `undefined` when none is needed.
 *
 * @throws {Error} If `prediction` has a keyword that `actual` lacks, which no
 *     annotation removes.
 */
export function annotationFor(actual, prediction) {
  const annotation = {};
  let target = actual;
  // A reference combined with further schemas, such as a format rule.
  if (Array.isArray(actual.allOf) && typeof prediction.$ref === 'string') {
    const index = actual.allOf.findIndex(
      member => member && typeof member.$ref === 'string' && Object.keys(member).length === 1,
    );
    if (index !== -1) {
      annotation.allOf = actual.allOf.filter((_, i) => i !== index);
      target = Object.fromEntries(Object.entries(actual).filter(([key]) => key !== 'allOf'));
      target.$ref = actual.allOf[index].$ref;
    }
  }
  const keywords = {};
  for (const [key, value] of Object.entries(target)) {
    if (key === 'description' || key === 'default') {
      if (JSON.stringify(value) !== JSON.stringify(prediction[key])) {
        throw new Error(`Cannot reproduce '${key}' of ${JSON.stringify(actual)}.`);
      }
      continue;
    }
    if (CLOSURE_KEYWORDS.includes(key) && value === false && prediction[key] === undefined) {
      annotation.closure = key;
      continue;
    }
    if (key === 'required' && Array.isArray(value) && Array.isArray(prediction.required)) {
      if ([...value].sort().join() === [...prediction.required].sort().join()) {
        if (value.join() !== prediction.required.join()) annotation.required = value;
        continue;
      }
    }
    if (key === 'properties' || key === 'items' || key === 'oneOf') {
      // Children carry their own annotations.
      continue;
    }
    if (JSON.stringify(value) !== JSON.stringify(prediction[key])) keywords[key] = value;
  }
  for (const key of Object.keys(prediction)) {
    if (!(key in target)) {
      throw new Error(`Cannot remove '${key}' from the derivation of ${JSON.stringify(actual)}.`);
    }
  }
  if (Object.keys(keywords).length > 0) annotation.keywords = keywords;
  return Object.keys(annotation).length > 0 ? annotation : undefined;
}

/**
 * Generates a node's Zod code, annotated with what the document writes that
 * the code does not express, and the node's JSON Schema.
 *
 * @param {object} schema The node.
 * @param {GenContext} ctx Generation context.
 * @param {{code: string, prediction: object}} [generated] The node's
 *     unannotated code and prediction, when the caller generated them.
 */
function annotatedNode(schema, ctx, generated = generateNode(schema, ctx)) {
  if (ctx.commonTypesUri === undefined) return {code: generated.code, prediction: schema};
  const annotation = annotationFor(schema, generated.prediction);
  if (!annotation) return {code: generated.code, prediction: schema};
  return {code: `spec(${generated.code}, ${literal(annotation)})`, prediction: schema};
}

/**
 * Generates Zod code for object schemas with child properties.
 */
export function generateObjectSchemaZod(schema, commonDefs, usedImports, indent = '      ') {
  return generateObjectNode(schema, {commonDefs, usedImports}, indent).code;
}

/**
 * Generates Zod code for array schemas.
 */
export function generateArrayZod(propSchema, commonDefs, usedImports) {
  return generateArrayNode(propSchema, {commonDefs, usedImports}).code;
}

export function generateRefPropertyZod(defName, desc, isRequired, usedImports) {
  usedImports.add(`${defName}Schema`);
  const marker = desc ? `REF:#/$defs/${defName}|${escapeStr(desc)}` : `REF:#/$defs/${defName}`;
  const code = `${defName}Schema.describe('${marker}')`;
  return isRequired ? code : `${code}.optional()`;
}

/**
 * Generates Zod expression for a component or function property schema.
 *
 * @param {string} propName The property's name.
 * @param {object} propSchema The property's schema.
 * @param {string[]} requiredList The required properties of the enclosing object.
 * @param {object} commonDefs The common types definitions.
 * @param {Set<string>} usedImports The imports used so far.
 * @param {string} [commonTypesUri] How the document writes the common types
 *     document; when set, the code is annotated to reproduce `propSchema`.
 */
export function generatePropertyZod(
  propName,
  propSchema,
  requiredList = [],
  commonDefs,
  usedImports,
  commonTypesUri,
  catalogDefs = {},
  referencedCatalogDefs = undefined,
) {
  const isRequired = requiredList.includes(propName);
  const ctx = {commonDefs, catalogDefs, referencedCatalogDefs, usedImports, commonTypesUri};
  const {code} = annotatedNode(propSchema, ctx, generateNode(propSchema, ctx, isRequired));
  return isRequired ? code : `${code}.optional()`;
}

/**
 * Merges properties and required arrays from a source schema into a target.
 */
export function mergeSchemaProperties(target, source) {
  if (source.properties && typeof source.properties === 'object') {
    target.properties = {...target.properties, ...source.properties};
  }
  if (Array.isArray(source.required)) {
    target.required = [...new Set([...target.required, ...source.required])];
  }
}

/**
 * Recursively flattens a schema (handling allOf and $refs) to extract all component properties and required fields.
 */
export function flattenSchema(schema, catalogDefs = {}, commonDefs = {}, visited = new Set()) {
  if (!schema || typeof schema !== 'object' || visited.has(schema)) {
    return {properties: {}, required: []};
  }
  visited.add(schema);

  const result = {properties: {}, required: []};

  if (typeof schema.$ref === 'string') {
    const refName = extractRefName(schema.$ref);
    const resolved = refName ? catalogDefs[refName] || commonDefs[refName] : null;
    if (resolved) {
      mergeSchemaProperties(result, flattenSchema(resolved, catalogDefs, commonDefs, visited));
    }
  }

  mergeSchemaProperties(result, schema);

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      mergeSchemaProperties(result, flattenSchema(sub, catalogDefs, commonDefs, visited));
    }
  }

  return result;
}

/**
 * Extracts function arguments schema, required fields, and returnType.
 */
export function extractFunctionDefinition(funcName, funcDef, catalogDefs = {}, commonDefs = {}) {
  let returnType = funcDef.returnType;
  if (!returnType && funcDef.properties?.returnType?.const) {
    returnType = funcDef.properties.returnType.const;
  }
  if (!returnType) {
    returnType = 'boolean';
  }

  let requiresUserActivation =
    funcDef.requiresUserActivation ?? funcDef.properties?.requiresUserActivation?.const;

  let argsSchema = funcDef.properties?.args;
  if (!argsSchema && Array.isArray(funcDef.allOf)) {
    for (const sub of funcDef.allOf) {
      if (!argsSchema && sub.properties?.args) {
        argsSchema = sub.properties.args;
      }
      if (requiresUserActivation === undefined) {
        requiresUserActivation =
          sub.requiresUserActivation ?? sub.properties?.requiresUserActivation?.const;
      }
    }
  }

  const {properties: argsProps, required: argsRequired} = argsSchema
    ? flattenSchema(argsSchema, catalogDefs, commonDefs)
    : {properties: {}, required: []};

  return {
    returnType,
    requiresUserActivation: Boolean(requiresUserActivation),
    argsProps,
    argsRequired,
    argsSchema,
    description: funcDef.description,
  };
}

/**
 * Returns how a catalog document writes the common types document in its
 * references, such as `common_types.json`, or `undefined` if it has none.
 */
export function commonTypesUriOf(catalogJson) {
  let found;
  const visit = node => {
    if (found !== undefined || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node.$ref === 'string') {
      const hash = node.$ref.indexOf('#');
      if (hash > 0 && node.$ref.substring(0, hash).endsWith('common_types.json')) {
        found = node.$ref.substring(0, hash);
        return;
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(catalogJson);
  return found;
}

/** The catalog definitions that a catalog computes rather than declares. */
const COMPUTED_DEFS = new Set(['anyComponent', 'anyFunction']);

/**
 * Returns the identifier of the model of a catalog definition.
 */
function defModelName(name) {
  return name === 'theme' ? 'ThemeDefSchema' : `${name}Schema`;
}

function collectLocalDefRefs(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectLocalDefRefs(item, out);
    return out;
  }
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
    out.add(node.$ref.slice('#/$defs/'.length).split('/')[0]);
  }
  for (const val of Object.values(node)) collectLocalDefRefs(val, out);
  return out;
}

function topologicalSortDefNames(names, catalogDefs) {
  const nameSet = new Set(names);
  const visited = new Set();
  const visiting = new Set();
  const sorted = [];
  const visit = name => {
    if (visited.has(name) || visiting.has(name) || !nameSet.has(name)) return;
    visiting.add(name);
    for (const dep of collectLocalDefRefs(catalogDefs[name])) {
      if (dep !== name) visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  };
  for (const name of names) visit(name);
  return sorted;
}

/**
 * Generates a catalog definition's model: a `specDef()`-named Zod object.
 */
function generateDefModel(name, schema, ctx) {
  let effectiveSchema = schema;
  if (Array.isArray(schema.allOf)) {
    const flattened = flattenSchema(schema, ctx.catalogDefs, ctx.commonDefs);
    if (
      schema.type === 'object' ||
      schema.properties ||
      Object.keys(flattened.properties).length > 0
    ) {
      const restSchema = {...schema};
      delete restSchema.allOf;
      effectiveSchema = {
        ...restSchema,
        type: 'object',
        properties: flattened.properties,
        ...(flattened.required.length > 0 ? {required: flattened.required} : {}),
      };
    }
  }
  let code;
  let prediction;
  if (effectiveSchema.type === 'object') {
    const node = generateObjectNode(effectiveSchema, ctx, '    ');
    ({code, prediction} = withModifiers(node.code, node.prediction, effectiveSchema));
  } else {
    ({code, prediction} = generateNode(effectiveSchema, ctx));
  }
  const annotation = annotationFor(effectiveSchema, prediction);
  const extra = annotation ? `, ${literal(annotation)}` : '';
  return `export const ${defModelName(name)} = specDef('${name}', ${code}${extra});\n\n`;
}

/**
 * Generates TypeScript component APIs from a catalog schema.
 */
export function generateComponentsFile(version, catalogJson, commonDefs, options = {}) {
  const catalogDefs = catalogJson.$defs || {};
  const referencedCatalogDefs = new Set();
  const usedImports = new Set();
  const discriminatorProp = catalogJson.discriminator?.propertyName || 'component';
  const idProp = 'id';
  const commonTypesImportPath = options.commonTypesImportPath || '../../schema/common-types.js';
  const typesImportPath = options.typesImportPath || '../../../catalog/types.js';
  const specImportPath = typesImportPath.replace(/types\.js$/, 'spec_annotations.js');
  const commonTypesUri = options.reproduceDocument ? commonTypesUriOf(catalogJson) : undefined;
  const ctx = {commonDefs, catalogDefs, referencedCatalogDefs, usedImports, commonTypesUri};
  const reproduce = commonTypesUri !== undefined;

  const compNames = Object.keys(catalogJson.components || {});
  const apiNames = [];
  const mixinDefs = new Set();
  let bodyCode = '';

  for (const compName of compNames) {
    const compDef = catalogJson.components[compName];
    const {properties, required} = flattenSchema(compDef, catalogDefs, commonDefs);
    const apiName = `${compName}Api`;
    apiNames.push(apiName);

    // The mixins the definition composes, and the schema of its own properties.
    const mixins = [];
    const spreads = [];
    let own = compDef;
    for (const member of Array.isArray(compDef.allOf) ? compDef.allOf : []) {
      if (typeof member.$ref !== 'string') {
        own = member;
        continue;
      }
      const refName = extractRefName(member.$ref);
      if (member.$ref.startsWith('#/$defs/') && catalogDefs[refName]) {
        mixinDefs.add(refName);
        mixins.push(defModelName(refName));
        spreads.push(refName);
      } else {
        mixins.push(`'${refName}'`);
      }
    }
    const description = compDef.description ?? (own !== compDef ? own.description : undefined);
    const ownKeys = new Set(Object.keys(own.properties || {}));
    const spreadKeys = new Set(
      spreads.flatMap(name => Object.keys(catalogDefs[name].properties || {})),
    );

    bodyCode += `export const ${apiName} = {\n`;
    bodyCode += `  name: '${compName}',\n`;
    bodyCode += `  schema: ${reproduce ? 'spec(' : ''}z\n`;
    bodyCode += `    .object({\n`;
    if (reproduce) {
      for (const name of spreads) bodyCode += `      ...${defModelName(name)}.shape,\n`;
    }

    const ownRequired = [];
    for (const [propName, propDef] of Object.entries(properties)) {
      if (propName === discriminatorProp || propName === idProp) {
        continue;
      }
      if (reproduce && spreadKeys.has(propName) && !ownKeys.has(propName)) continue;
      const zodCode = generatePropertyZod(
        propName,
        propDef,
        required,
        commonDefs,
        usedImports,
        reproduce && ownKeys.has(propName) ? commonTypesUri : undefined,
        catalogDefs,
        referencedCatalogDefs,
      );
      bodyCode += `      '${propName}': ${zodCode},\n`;
      if (ownKeys.has(propName) && required.includes(propName)) ownRequired.push(propName);
    }

    bodyCode += `    })\n`;
    if (reproduce && description) {
      bodyCode += `    .describe('${escapeStr(description)}')\n`;
    }
    bodyCode += `    .strict()`;
    if (reproduce) {
      const annotation = [`mixins: [${mixins.join(', ')}]`];
      const authoredRequired = (own.required || []).filter(
        name => name !== discriminatorProp && name !== idProp,
      );
      if (authoredRequired.join() !== ownRequired.join()) {
        annotation.push(`required: ${literal(authoredRequired)}`);
      }
      bodyCode += `, {${annotation.join(', ')}})`;
    }
    bodyCode += `,\n`;
    bodyCode += `} satisfies ComponentApi;\n\n`;
  }

  let defsCode = '';
  if (reproduce) {
    // Expand referencedCatalogDefs transitively across local $defs.
    const queue = [...referencedCatalogDefs, ...mixinDefs];
    while (queue.length > 0) {
      const current = queue.pop();
      for (const dep of collectLocalDefRefs(catalogDefs[current])) {
        if (catalogDefs[dep] && !mixinDefs.has(dep) && !referencedCatalogDefs.has(dep)) {
          referencedCatalogDefs.add(dep);
          queue.push(dep);
        }
      }
    }
    let mixinDefsCode = '';
    for (const name of topologicalSortDefNames([...mixinDefs], catalogDefs)) {
      mixinDefsCode += generateDefModel(name, catalogDefs[name], ctx);
    }
    const leafDefNames = topologicalSortDefNames(
      [...referencedCatalogDefs].filter(name => !mixinDefs.has(name)),
      catalogDefs,
    );
    for (const name of leafDefNames) {
      defsCode += generateDefModel(name, catalogDefs[name], ctx);
    }
    defsCode += mixinDefsCode;
    if (catalogDefs.theme) defsCode += generateDefModel('theme', catalogDefs.theme, ctx);
    for (const name of Object.keys(catalogDefs)) {
      if (
        !COMPUTED_DEFS.has(name) &&
        !mixinDefs.has(name) &&
        !referencedCatalogDefs.has(name) &&
        name !== 'theme'
      ) {
        throw new Error(`The catalog definition '${name}' has no model.`);
      }
    }
  }

  let out = HEADER;
  out += `import {z} from 'zod';

${reproduce ? `import {${defsCode ? 'spec, specDef' : 'spec'}} from '${specImportPath}';\n` : ''}import {${reproduce ? 'CatalogDocumentOptions, ' : ''}ComponentApi} from '${typesImportPath}';
import {
  ${Array.from(usedImports).sort().join(',\n  ')},
} from '${commonTypesImportPath}';

`;

  out += defsCode;
  out += bodyCode;

  out += `export const BASIC_COMPONENTS: ComponentApi[] = [\n`;
  for (const name of apiNames) {
    out += `  ${name},\n`;
  }
  out += `];\n`;

  if (reproduce) {
    out += generateDocumentOptions(catalogJson, commonTypesUri, catalogDefs.theme !== undefined);
  }

  return out;
}

/**
 * Generates the scalar document-level fields of a catalog document as
 * `CatalogDocumentOptions`.
 */
function generateDocumentOptions(catalogJson, commonTypesUri, hasThemeDef) {
  const fields = [];
  const add = (key, value) => fields.push(`  ${key}: ${literal(value)},`);
  if (catalogJson.$schema !== undefined) add('schemaUri', catalogJson.$schema);
  if (catalogJson.$id !== undefined) add('schemaId', catalogJson.$id);
  if (catalogJson.title !== undefined) add('title', catalogJson.title);
  if (catalogJson.description !== undefined) add('description', catalogJson.description);
  if (catalogJson.instructions !== undefined) add('instructions', catalogJson.instructions);
  add('declaredProtocolVersion', catalogJson.protocolVersion ?? null);
  add('commonTypesUri', commonTypesUri);
  if (hasThemeDef) fields.push(`  defModels: [ThemeDefSchema],`);
  return `
/**
 * The document-level fields of the published catalog document.
 */
export const BASIC_CATALOG_DOCUMENT_OPTIONS = {
${fields.join('\n')}
} satisfies CatalogDocumentOptions;
`;
}

/**
 * Generates TypeScript function APIs from a catalog schema.
 */
export function generateFunctionsFile(version, catalogJson, commonDefs, options = {}) {
  const catalogDefs = catalogJson.$defs || {};
  const usedImports = new Set();
  const funcNames = Object.keys(catalogJson.functions || {});
  const apiNames = [];
  const commonTypesImportPath = options.commonTypesImportPath || '../../schema/common-types.js';
  const specImportPath = options.specImportPath || '../../../catalog/spec_annotations.js';
  const commonTypesUri = options.reproduceDocument ? commonTypesUriOf(catalogJson) : undefined;
  const reproduce = commonTypesUri !== undefined;
  let bodyCode = '';

  for (const funcName of funcNames) {
    const funcDef = catalogJson.functions[funcName];
    const {returnType, requiresUserActivation, argsProps, argsRequired, argsSchema, description} =
      extractFunctionDefinition(funcName, funcDef, catalogDefs, commonDefs);
    const apiName = `${toPascalCase(funcName)}Api`;
    apiNames.push(apiName);

    bodyCode += `/**\n`;
    if (description) {
      bodyCode += ` * ${description.replace(/\n/g, '\n * ')}\n`;
    }
    bodyCode += ` */\n`;
    bodyCode += `export const ${apiName} = {\n`;
    bodyCode += `  name: '${funcName}' as const,\n`;
    bodyCode += `  returnType: '${returnType}' as const,\n`;
    if (requiresUserActivation) {
      bodyCode += `  requiresUserActivation: true as const,\n`;
    }
    if (reproduce && description) {
      bodyCode += `  description: '${escapeStr(description)}',\n`;
    }
    bodyCode += `  schema: ${reproduce ? 'spec(' : ''}z.object({\n`;

    const prediction = {type: 'object', properties: {}};
    for (const [argName, argDef] of Object.entries(argsProps)) {
      const zodCode = generatePropertyZod(
        argName,
        argDef,
        argsRequired,
        commonDefs,
        usedImports,
        commonTypesUri,
      );
      bodyCode += `    '${argName}': ${zodCode},\n`;
      prediction.properties[argName] = argDef;
    }
    const required = Object.keys(argsProps).filter(name => argsRequired.includes(name));
    if (required.length > 0) prediction.required = required;

    bodyCode += `  })`;
    if (reproduce) {
      // Every argument model is annotated, which marks it as one whose call
      // schema `toJson` computes.
      const annotation = annotationFor(argsSchema ?? {type: 'object', properties: {}}, prediction);
      bodyCode += `, ${literal(annotation ?? {closure: 'none'})})`;
    }
    bodyCode += `,\n`;
    bodyCode += `};\n\n`;
  }

  let out = HEADER;
  out += `import {z} from 'zod';\n`;
  if (reproduce || usedImports.size > 0) {
    out += '\n';
  }
  if (reproduce) {
    out += `import {spec} from '${specImportPath}';\n`;
  }
  if (usedImports.size > 0) {
    out += `import {
  ${Array.from(usedImports).sort().join(',\n  ')},
} from '${commonTypesImportPath}';\n\n`;
  } else {
    out += '\n';
  }

  out += bodyCode;

  out += `export const BASIC_FUNCTION_APIS = [\n`;
  for (const name of apiNames) {
    out += `  ${name},\n`;
  }
  out += `];\n\n`;
  const versionPrefix = version ? `${version.toUpperCase().replace(/[^A-Z0-9]/g, '')}_` : '';
  out += `export const ${versionPrefix}SPEC_FUNCTION_APIS = BASIC_FUNCTION_APIS;\n`;

  return out;
}

/**
 * Generates component and function TypeScript APIs from a catalog schema and common types definitions.
 *
 * @param {object} options
 * @param {string} options.version Protocol version identifier.
 * @param {string} options.catalogPath Path to catalog.json.
 * @param {string} options.commonTypesPath Path to common_types.json.
 * @param {string} [options.componentsOutPath] Path to output component APIs file.
 * @param {string} [options.functionsOutPath] Path to output function APIs file.
 * @param {string} [options.commonTypesImportPath] Relative import path for common types.
 * @param {string} [options.typesImportPath] Relative import path for catalog types.
 * @param {string} [options.specImportPath] Relative import path for spec annotations,
 *     from the functions file.
 */
export function generateCatalogApi({
  version,
  catalogPath,
  commonTypesPath,
  componentsOutPath,
  functionsOutPath,
  commonTypesImportPath,
  typesImportPath,
  specImportPath,
}) {
  const commonJson = JSON.parse(readFileSync(commonTypesPath, 'utf8'));
  const catalogJson = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const commonDefs = commonJson.$defs || {};

  if (componentsOutPath) {
    const componentsTs = generateComponentsFile(version, catalogJson, commonDefs, {
      commonTypesImportPath,
      typesImportPath,
      reproduceDocument: true,
    });
    writeFileSync(componentsOutPath, componentsTs);
  }

  if (functionsOutPath) {
    const functionsTs = generateFunctionsFile(version, catalogJson, commonDefs, {
      commonTypesImportPath,
      specImportPath,
      reproduceDocument: true,
    });
    writeFileSync(functionsOutPath, functionsTs);
  }
}
