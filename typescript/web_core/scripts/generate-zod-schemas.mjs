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

import {readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {jsonSchemaToZod} from 'json-schema-to-zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const getHeader = version => `/*
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
// Generated from specification/${version}/json/ via scripts/generate-zod-schemas.mjs
`;

/**
 * Cleans generic syntax emitted by json-schema-to-zod.
 *
 * @param {string} code Raw JS string.
 * @returns {string} Cleaned code.
 */
function transformZodSyntax(code) {
  let clean = code;
  clean = clean.replace(/z\.literal\("__REF__([^"]+)__"\)/g, '$1');
  clean = clean.replace(/z\.core\.\$ZodIssue/g, 'z.ZodIssue');
  clean = clean.replace(/ctx\.addIssue\(([^;]+)\);/g, 'ctx.addIssue($1 as any);');
  clean = clean.replace(/== i\)/g, '=== i)');
  return clean;
}

/**
 * Handles type-specific overrides and constraints.
 *
 * @param {string} code Cleaned code.
 * @param {object} options Metadata options.
 * @returns {string} Modified code.
 */
function applyNameSpecificFixups(code, options = {}) {
  let clean = code;

  // json-schema-to-zod does not translate JSON Schema if/then conditional assertions
  // (catalog_definition.json specifies that requiresUserActivation=true requires allowedCallers='rendererOnly').
  if (options.name === 'FunctionDefinition') {
    clean = clean.replace(
      '.describe("Describes a function\'s validation schema and interface metadata.")',
      `.superRefine((val, ctx) => {
        if (val && val.requiresUserActivation && val.allowedCallers !== 'rendererOnly') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "requiresUserActivation=true must have allowedCallers='rendererOnly'.",
            path: ['allowedCallers'],
          });
        }
      }).describe("Describes a function's validation schema and interface metadata.")`,
    );
  }

  return clean;
}

/**
 * Normalizes and cleans JavaScript/TypeScript code emitted by json-schema-to-zod.
 *
 * @param {string} code Raw JS string emitted by json-schema-to-zod.
 * @param {object} options Contextual metadata for type-specific fixups.
 * @returns {string} Clean, type-safe, lint-compliant Zod code string.
 */
function transformGeneratedZodCode(code, options = {}) {
  const cleanSyntax = transformZodSyntax(code);
  return applyNameSpecificFixups(cleanSyntax, options);
}

/**
 * Recursively extracts all #/$defs/ references for a given schema node.
 *
 * @param {object} node Schema node.
 * @param {Set<string>} deps Set of accumulated dependencies.
 * @returns {Set<string>} The dependency set.
 */
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

/**
 * Analyzes the schema definition dependency graph, detects cycles using DFS,
 * and produces a valid topological ordering along with the set of cyclic/lazy edges.
 *
 * @param {Record<string, object>} defs Map of definition names to JSON Schema objects.
 * @returns {{topologicalOrder: string[], lazyEdges: Set<string>}}
 */
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
        // Cycle detected: dep must be lazily evaluated in node
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

/**
 * Resolves a $ref pointer to an AST placeholder or Zod lazy wrapper.
 *
 * @param {string} refString The $ref pointer string.
 * @param {string} parentDefName The enclosing definition name.
 * @param {Set<string>} [lazyEdges] Set of detected cycle edges.
 * @param {string[]} [topologicalOrder] Topologically sorted definition names.
 * @returns {object|null} Modified JSON Schema node or null.
 */
function resolveRefTarget(refString, parentDefName, lazyEdges, topologicalOrder) {
  if (refString.startsWith('https://') || refString.startsWith('http://')) {
    return {type: 'object', additionalProperties: true};
  }
  if (refString === 'catalog.json#/$defs/theme') {
    return {};
  }
  if (refString.startsWith('catalog.json#/$defs/')) {
    return {type: 'object', additionalProperties: true};
  }
  const idx = refString.indexOf('#/$defs/');
  if (idx === -1) return null;
  const targetName = refString.substring(idx + 8);
  if (targetName === 'theme') {
    return {};
  }
  if (targetName === 'anyFunction' || targetName === 'anyComponent') {
    return {type: 'object', additionalProperties: true};
  }
  if (
    lazyEdges &&
    (lazyEdges.has(`${parentDefName}->${targetName}`) ||
      (topologicalOrder &&
        topologicalOrder.indexOf(targetName) > topologicalOrder.indexOf(parentDefName)))
  ) {
    return {enum: [`__REF__z.lazy(() => ${targetName}Schema)__`]};
  }
  if (targetName === 'ComponentId') {
    return {enum: ['__REF__ComponentIdSchema__']};
  }
  return {enum: ['__REF__' + targetName + 'Schema__']};
}

/**
 * Helper to recursively prepare JSON Schema nodes by resolving local/remote #/$defs references.
 *
 * @param {object} node Schema node.
 * @param {string} parentDefName Enclosing definition name.
 * @param {Set<string>} [lazyEdges] Set of detected cycle edges.
 * @param {string[]} [topologicalOrder] Topologically sorted definition names.
 * @returns {object} Prepared schema node.
 */
function prepareRef(node, parentDefName, lazyEdges, topologicalOrder) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map(n => prepareRef(n, parentDefName, lazyEdges, topologicalOrder));
  }
  if (typeof node.$ref === 'string') {
    const resolved = resolveRefTarget(node.$ref, parentDefName, lazyEdges, topologicalOrder);
    if (resolved) return resolved;
  }
  const res = {};
  for (const [k, v] of Object.entries(node)) {
    // Simplify oneOf to anyOf for union schemas so jsonSchemaToZod emits clean z.union([...])
    if (
      k === 'oneOf' &&
      Array.isArray(v) &&
      parentDefName !== 'FunctionCall' &&
      parentDefName !== 'FunctionResponse'
    ) {
      res['anyOf'] = v.map(n => prepareRef(n, parentDefName, lazyEdges, topologicalOrder));
    } else if (k === 'oneOf' && parentDefName === 'FunctionCall') {
      // Omit external catalog anyFunction hook from FunctionCall object definition
      continue;
    } else if (k === 'patternProperties' && parentDefName === 'Extensions') {
      continue;
    } else {
      res[k] = prepareRef(v, parentDefName, lazyEdges, topologicalOrder);
    }
  }
  if (parentDefName === 'Extensions' && !res.type) {
    res.type = 'object';
    res.additionalProperties = true;
  }
  return res;
}

/**
 * Helper to inspect a schema object and extract all referenced common-types schema names.
 *
 * @param {object} node Schema node.
 * @param {Set<string>} commonDefNames Set of definition names in common_types.json.
 * @param {Set<string>} refs Accumulated import set.
 * @returns {Set<string>} Set of required Zod schema imports.
 */
function findCommonRefs(node, commonDefNames, refs = new Set()) {
  if (!node || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    node.forEach(n => findCommonRefs(n, commonDefNames, refs));
    return refs;
  }
  if (typeof node.$ref === 'string') {
    const idx = node.$ref.indexOf('#/$defs/');
    if (idx !== -1) {
      const targetName = node.$ref.substring(idx + 8);
      if (commonDefNames.has(targetName)) {
        refs.add(targetName + 'Schema');
      }
    }
  }
  for (const v of Object.values(node)) {
    findCommonRefs(v, commonDefNames, refs);
  }
  return refs;
}

/**
 * Generates common-types.ts for a given specification version.
 *
 * @param {string} specDir Specification directory.
 * @param {string} destDir Destination directory.
 * @param {string} version Version tag (e.g. 'v0_9' or 'v1_0').
 * @param {string} prefixCode Additional TypeScript code to prepend before schemas.
 * @param {string} suffixCode Additional TypeScript code to append after schemas.
 * @returns {Set<string>} Set of definition names generated.
 */
function generateCommonTypes(specDir, destDir, version, prefixCode = '', suffixCode = '') {
  const commonJson = JSON.parse(readFileSync(join(specDir, 'common_types.json'), 'utf8'));
  const {topologicalOrder, lazyEdges} = analyzeDependencies(commonJson.$defs);
  const recursiveSchemas = new Set([
    ...Array.from(lazyEdges).map(e => e.split('->')[0]),
    ...Array.from(lazyEdges).map(e => e.split('->')[1]),
  ]);

  let commonTs = getHeader(version) + "import {z} from 'zod';\n\n";

  if (prefixCode) {
    commonTs += prefixCode + '\n\n';
  }

  const defKeys = [
    ...topologicalOrder.filter(k => k in commonJson.$defs),
    ...Object.keys(commonJson.$defs).filter(k => !topologicalOrder.includes(k)),
  ];

  for (const name of defKeys) {
    const rawDef = JSON.parse(JSON.stringify(commonJson.$defs[name]));
    // Dynamically inject REF pointer tag into description
    const desc = rawDef.description
      ? `REF:#/$defs/${name}|${rawDef.description}`
      : `REF:#/$defs/${name}`;
    rawDef.description = desc;

    const prep = prepareRef(rawDef, name, lazyEdges, topologicalOrder);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${name}Schema`,
      type: name,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name, version});

    if (name === 'ComponentId') {
      const parts = code.split('\nexport type ');
      const schemaExp = parts[0].replace(`export const ComponentIdSchema = `, '').trim();
      const typePart = parts[1] || 'ComponentId = z.infer<typeof ComponentIdSchema>';
      code = `export const ComponentIdSchema = markChildRef(\n  ${schemaExp},\n  'component-id',\n);\nexport type ${typePart}`;
    } else if (name === 'ChildList') {
      const parts = code.split('\nexport type ');
      const schemaExp = parts[0].replace(`export const ChildListSchema = `, '').trim();
      const typePart = parts[1] || 'ChildList = z.infer<typeof ChildListSchema>';
      code = `export const ChildListSchema = markChildRef(\n  ${schemaExp},\n  'child-list',\n);\nexport type ${typePart}`;
    } else if (name === 'Child') {
      code = `export const ChildSchema = ComponentIdSchema;\nexport type Child = z.infer<typeof ChildSchema>;`;
    }

    if (recursiveSchemas.has(name)) {
      code = code.replace(
        new RegExp(`export const ${name}Schema =`),
        `export const ${name}Schema: z.ZodType<any> =`,
      );
    }

    if (name === 'DynamicValue' && version === 'v1_0') {
      code = code.replace(
        'z.record(z.string(), z.any())',
        "z.record(z.string(), z.any()).refine((obj) => !obj || (!('path' in obj) && !('call' in obj)))",
      );
    }

    if (name === 'Extensions') {
      code = `export const ExtensionsSchema = z.record(z.string(), z.any()).describe("REF:#/$defs/Extensions|Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.");\nexport type Extensions = z.infer<typeof ExtensionsSchema>;`;
    }

    commonTs += code + '\n\n';
  }

  if (suffixCode) {
    commonTs += suffixCode + '\n';
  }

  const commonEntries = defKeys.map(k => `  ${k}: ${k}Schema,`).join('\n');
  if (version === 'v0_9') {
    commonTs += `\nexport const CommonSchemas = {\n${commonEntries}\n  AnyComponent: AnyComponentSchema,\n};\n`;
  } else {
    commonTs += `\nexport const CommonSchemas = {\n${commonEntries}\n};\n`;
  }

  writeFileSync(join(destDir, 'common-types.ts'), commonTs);
  return new Set(Object.keys(commonJson.$defs));
}

const V09_PREFIX_HELPERS = `
/** The unique identifier for a component. */
export type ChildRefKind = 'component-id' | 'child-list';

function markChildRef<T extends z.ZodTypeAny>(schema: T, ref: ChildRefKind): T {
  (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef = ref;
  return schema;
}

export function childRefKindOf(schema: z.ZodTypeAny): ChildRefKind | undefined {
  return (schema?._def as {a2uiChildRef?: ChildRefKind} | undefined)?.a2uiChildRef;
}

export interface RefSchemaOptions {
  readonly description?: string;
}

export const TemplateChildListSchema = z
  .object({
    'componentId': z.lazy(() => ComponentIdSchema),
    'path': z
      .string()
      .describe('The path to the list of component property objects in the data model.'),
  })
  .describe('REF:#/$defs/TemplateChildList');
`;

const V09_SUFFIX_HELPERS = `
export function componentId(options: RefSchemaOptions = {}): typeof ComponentIdSchema {
  if (options.description === undefined) {
    return ComponentIdSchema;
  }
  return ComponentIdSchema.describe(\`REF:#/$defs/ComponentId|\${options.description}\`);
}

export function dynamicString(description?: string) {
  return description
    ? DynamicStringSchema.describe(\`REF:#/$defs/DynamicString|\${description}\`)
    : DynamicStringSchema;
}

export function dynamicNumber(description?: string) {
  return description
    ? DynamicNumberSchema.describe(\`REF:#/$defs/DynamicNumber|\${description}\`)
    : DynamicNumberSchema;
}

export function dynamicBoolean(description?: string) {
  return description
    ? DynamicBooleanSchema.describe(\`REF:#/$defs/DynamicBoolean|\${description}\`)
    : DynamicBooleanSchema;
}

export function dynamicValue(description?: string) {
  return description
    ? DynamicValueSchema.describe(\`REF:#/$defs/DynamicValue|\${description}\`)
    : DynamicValueSchema;
}

export function dynamicStringList(description?: string) {
  return description
    ? DynamicStringListSchema.describe(\`REF:#/$defs/DynamicStringList|\${description}\`)
    : DynamicStringListSchema;
}

export function childList(options: RefSchemaOptions = {}): typeof ChildListSchema {
  if (options.description === undefined) {
    return ChildListSchema;
  }
  return ChildListSchema.describe(options.description);
}

export const AnyComponentSchema = z
  .object({
    'component': z.string().describe('The type name of the component.'),
    'id': ComponentIdSchema.optional(),
    'weight': z.number().optional(),
  })
  .passthrough()
  .describe('A generic A2UI component definition.');
export type AnyComponent = z.infer<typeof AnyComponentSchema>;
`;

/**
 * Generates all schema files for protocol version v0.9.
 *
 * @param {string} root Base web_core directory.
 */
function generateV09Schemas(root) {
  console.log('Generating v0.9 Zod schemas from JSON specification files...');
  const specDir = join(root, '..', '..', 'specification', 'v0_9', 'json');
  const destDir = join(root, 'src', 'v0_9', 'schema');

  // 1. common-types.ts
  generateCommonTypes(specDir, destDir, 'v0_9', V09_PREFIX_HELPERS, V09_SUFFIX_HELPERS);

  // 2. server-to-client.ts
  const s2cJson = JSON.parse(readFileSync(join(specDir, 'server_to_client.json'), 'utf8'));
  const s2cMsgNames = s2cJson.oneOf.map(ref => ref.$ref.replace('#/$defs/', ''));

  let s2cTs = getHeader('v0_9') + "import {z} from 'zod';\n\n";

  for (const msgName of s2cMsgNames) {
    const rawDef = s2cJson.$defs[msgName];
    const prep = prepareRef(rawDef, msgName);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${msgName}Schema`,
      type: msgName,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name: msgName, version: 'v0_9'});
    // Support v0.9 and v0.9.1 in message wrapper version
    code = code.replace(/z\.literal\("v0\.9"\)/g, 'z.enum(["v0.9", "v0.9.1"])');
    s2cTs += code + '\n\n';
  }

  s2cTs += `export const A2uiMessageSchema = z.union([
  ${s2cMsgNames.map(m => `${m}Schema`).join(',\n  ')},
]);
export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;

export const A2uiMessageListSchema = z.array(A2uiMessageSchema).describe('A list of messages.');
export type A2uiMessageList = z.infer<typeof A2uiMessageListSchema>;

export const A2uiMessageListWrapperSchema = z
  .object({
    messages: A2uiMessageListSchema,
  })
  .strict()
  .describe('An object wrapping a list of messages.');
export type A2uiMessageListWrapper = z.infer<typeof A2uiMessageListWrapperSchema>;
`;
  writeFileSync(join(destDir, 'server-to-client.ts'), s2cTs);

  // 3. client-to-server.ts
  const c2sJson = JSON.parse(readFileSync(join(specDir, 'client_to_server.json'), 'utf8'));
  const cdmJson = JSON.parse(readFileSync(join(specDir, 'client_data_model.json'), 'utf8'));

  let c2sTs = getHeader('v0_9') + "import {z} from 'zod';\n\n";

  const actionPrep = prepareRef(c2sJson.properties.action, 'A2uiClientAction');
  let actionCode = jsonSchemaToZod(actionPrep, {
    module: 'esm',
    name: 'A2uiClientActionSchema',
    type: 'A2uiClientAction',
    noImport: true,
  });
  actionCode = transformGeneratedZodCode(actionCode, {name: 'A2uiClientAction', version: 'v0_9'});
  actionCode = actionCode.replace(/\.passthrough\(\)/g, '.strict()');
  c2sTs += actionCode + '\n\n';

  const valErrorPrep = prepareRef(c2sJson.properties.error.oneOf[0], 'A2uiValidationError');
  let valErrorCode = jsonSchemaToZod(valErrorPrep, {
    module: 'esm',
    name: 'A2uiValidationErrorSchema',
    noImport: true,
  });
  valErrorCode = transformGeneratedZodCode(valErrorCode, {
    name: 'A2uiValidationError',
    version: 'v0_9',
  });
  c2sTs += valErrorCode + '\n\n';

  const genErrorPrep = prepareRef(c2sJson.properties.error.oneOf[1], 'A2uiGenericError');
  let genErrorCode = jsonSchemaToZod(genErrorPrep, {
    module: 'esm',
    name: 'A2uiGenericErrorSchema',
    noImport: true,
  });
  genErrorCode = transformGeneratedZodCode(genErrorCode, {
    name: 'A2uiGenericError',
    version: 'v0_9',
  });
  genErrorCode = genErrorCode.replace(
    'code: z.any()',
    "code: z.string().refine(c => c !== 'VALIDATION_FAILED')",
  );
  c2sTs += genErrorCode + '\n\n';

  c2sTs += `export const A2uiClientErrorSchema = z.union([A2uiValidationErrorSchema, A2uiGenericErrorSchema]);\nexport type A2uiClientError = z.infer<typeof A2uiClientErrorSchema>;\n\n`;

  c2sTs += `export const A2uiClientMessageSchema = z
  .object({
    version: z.enum(['v0.9', 'v0.9.1']),
  })
  .and(
    z.union([z.object({action: A2uiClientActionSchema}), z.object({error: A2uiClientErrorSchema})]),
  );
export type A2uiClientMessage = z.infer<typeof A2uiClientMessageSchema>;\n\n`;

  const cdmPrep = prepareRef(cdmJson, 'A2uiClientDataModel');
  let cdmCode = jsonSchemaToZod(cdmPrep, {
    module: 'esm',
    name: 'A2uiClientDataModelSchema',
    type: 'A2uiClientDataModel',
    noImport: true,
  });
  cdmCode = transformGeneratedZodCode(cdmCode, {name: 'A2uiClientDataModel', version: 'v0_9'});
  cdmCode = cdmCode.replace(/z\.literal\("v0\.9"\)/g, 'z.enum(["v0.9", "v0.9.1"])');
  c2sTs += cdmCode + '\n\n';

  c2sTs += `export const A2uiClientMessageListSchema = z
  .array(A2uiClientMessageSchema)
  .describe('A list of client messages.');
export type A2uiClientMessageList = z.infer<typeof A2uiClientMessageListSchema>;

export const A2uiClientMessageListWrapperSchema = z
  .object({
    messages: A2uiClientMessageListSchema,
  })
  .strict()
  .describe('An object wrapping a list of client messages.');
export type A2uiClientMessageListWrapper = z.infer<typeof A2uiClientMessageListWrapperSchema>;
`;
  writeFileSync(join(destDir, 'client-to-server.ts'), c2sTs);

  // 4. client-capabilities.ts
  const ccJson = JSON.parse(readFileSync(join(specDir, 'client_capabilities.json'), 'utf8'));
  let ccTs =
    getHeader('v0_9') +
    `import {z} from 'zod';\n\nexport type JsonSchema = Record<string, any>;\n\n`;

  for (const [name, def] of Object.entries(ccJson.$defs)) {
    const typeName = name === 'Catalog' ? 'InlineCatalog' : name;
    const prep = prepareRef(def, name);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${typeName}Schema`,
      type: typeName,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name: typeName, version: 'v0_9'});
    ccTs += code + '\n\n';
  }

  const v09CapsPrep = prepareRef(ccJson.properties['v0.9'], 'A2uiVersionCapabilities');
  let v09CapsCode = jsonSchemaToZod(v09CapsPrep, {
    module: 'esm',
    name: 'A2uiVersionCapabilitiesSchema',
    type: 'A2uiVersionCapabilities',
    noImport: true,
  });
  v09CapsCode = transformGeneratedZodCode(v09CapsCode, {
    name: 'A2uiVersionCapabilities',
    version: 'v0_9',
  });
  v09CapsCode = v09CapsCode.replace(/CatalogSchema/g, 'InlineCatalogSchema');
  ccTs += v09CapsCode + '\n\n';

  ccTs += `export type A2uiClientCapabilities =
  | {
      'v0.9': A2uiVersionCapabilities;
      'v0.9.1'?: A2uiVersionCapabilities;
    }
  | {
      'v0.9'?: A2uiVersionCapabilities;
      'v0.9.1': A2uiVersionCapabilities;
    };
`;
  writeFileSync(join(destDir, 'client-capabilities.ts'), ccTs);

  // 5. index.ts
  const indexTs =
    getHeader('v0_9') +
    `export * from './common-types.js';
export * from './server-to-client.js';
export * from './client-to-server.js';
export * from './client-capabilities.js';
`;
  writeFileSync(join(destDir, 'index.ts'), indexTs);
}

const V10_PREFIX_HELPERS = `
export type ChildRefKind = 'component-id' | 'child-list';

function markChildRef<T extends z.ZodTypeAny>(schema: T, ref: ChildRefKind): T {
  (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef = ref;
  return schema;
}

export function childRefKindOf(schema: z.ZodTypeAny): ChildRefKind | undefined {
  return (schema?._def as {a2uiChildRef?: ChildRefKind} | undefined)?.a2uiChildRef;
}

export interface RefSchemaOptions {
  readonly description?: string;
}

export const TemplateChildListSchema = z
  .object({
    'componentId': z.lazy(() => ComponentIdSchema),
    'path': z
      .string()
      .describe('The path to the list of component property objects in the data model.'),
  })
  .strict()
  .describe(
    'REF:#/$defs/TemplateChildList|A template for generating a dynamic list of children from a data model list. The \`componentId\` is the component to use as a template.',
  );
export type TemplateChildList = z.infer<typeof TemplateChildListSchema>;
`;

const V10_SUFFIX_HELPERS = `
export function componentId(options: RefSchemaOptions = {}): typeof ComponentIdSchema {
  if (options.description === undefined) {
    return ComponentIdSchema;
  }
  return ComponentIdSchema.describe(\`REF:#/$defs/ComponentId|\${options.description}\`);
}

export function dynamicString(description?: string) {
  return description
    ? DynamicStringSchema.describe(\`REF:#/$defs/DynamicString|\${description}\`)
    : DynamicStringSchema;
}

export function dynamicNumber(description?: string) {
  return description
    ? DynamicNumberSchema.describe(\`REF:#/$defs/DynamicNumber|\${description}\`)
    : DynamicNumberSchema;
}

export function dynamicBoolean(description?: string) {
  return description
    ? DynamicBooleanSchema.describe(\`REF:#/$defs/DynamicBoolean|\${description}\`)
    : DynamicBooleanSchema;
}

export function dynamicValue(description?: string) {
  return description
    ? DynamicValueSchema.describe(\`REF:#/$defs/DynamicValue|\${description}\`)
    : DynamicValueSchema;
}

export function dynamicStringList(description?: string) {
  return description
    ? DynamicStringListSchema.describe(\`REF:#/$defs/DynamicStringList|\${description}\`)
    : DynamicStringListSchema;
}

export function childList(options: RefSchemaOptions = {}): typeof ChildListSchema {
  if (options.description === undefined) {
    return ChildListSchema;
  }
  return ChildListSchema.describe(\`REF:#/$defs/ChildList|\${options.description}\`);
}
`;

/**
 * Generates all schema files for protocol version v1.0.
 *
 * @param {string} root Base web_core directory.
 */
function generateV10Schemas(root) {
  console.log('Generating v1.0 Zod schemas from JSON specification files...');
  const specDir = join(root, '..', '..', 'specification', 'v1_0', 'json');
  const destDir = join(root, 'src', 'v1_0', 'schema');

  // 1. common-types.ts
  const commonDefNames = generateCommonTypes(
    specDir,
    destDir,
    'v1_0',
    V10_PREFIX_HELPERS,
    V10_SUFFIX_HELPERS,
  );

  // 2. agent-to-renderer.ts
  const a2rJson = JSON.parse(readFileSync(join(specDir, 'agent_to_renderer.json'), 'utf8'));
  const a2rMessageNames = a2rJson.oneOf.map(ref => ref.$ref.replace('#/$defs/', ''));
  const a2rImports = Array.from(
    new Set([...findCommonRefs(a2rJson, commonDefNames), 'ComponentCommonSchema']),
  ).sort();

  let a2rTs =
    getHeader('v1_0') +
    `import {z} from 'zod';
import {${a2rImports.join(', ')}} from './common-types.js';

/** Zod schema validating any component payload in a v1.0 message (excluding Surface). */
export const AnyComponentSchema = ComponentCommonSchema.extend({
  component: z.string(),
})
  .passthrough()
  .refine(comp => comp.component !== 'Surface', {
    message:
      'Component type cannot be "Surface". "Surface" is a top-level protocol container defined in createSurface, not a child component.',
  });
export type AnyComponent = z.infer<typeof AnyComponentSchema>;

/** Zod schema validating a non-empty array of UI component payloads. */
export const ComponentsListSchema = z.array(AnyComponentSchema).min(1);
export type ComponentsList = z.infer<typeof ComponentsListSchema>;

`;

  for (const msgName of a2rMessageNames) {
    const rawDef = a2rJson.$defs[msgName];
    const prep = prepareRef(rawDef, msgName);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${msgName}Schema`,
      type: msgName,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name: msgName, version: 'v1_0'});
    a2rTs += code + '\n\n';
  }

  a2rTs += `/** Union schema validating any incoming v1.0 agent-to-renderer message envelope. */
export const AgentToRendererMessageSchema = z.union([
  ${a2rMessageNames.map(m => `${m}Schema`).join(',\n  ')},
]);
export type AgentToRendererMessage = z.infer<typeof AgentToRendererMessageSchema>;
`;

  writeFileSync(join(destDir, 'agent-to-renderer.ts'), a2rTs);

  // 3. renderer-to-agent.ts
  const r2aJson = JSON.parse(readFileSync(join(specDir, 'renderer_to_agent.json'), 'utf8'));
  const r2aMessageProps = r2aJson.oneOf.map(item => item.required.find(k => k !== 'version'));
  const r2aMessageNames = [];
  const r2aImports = Array.from(findCommonRefs(r2aJson, commonDefNames)).sort();

  let r2aTs =
    getHeader('v1_0') +
    `import {z} from 'zod';
import {${r2aImports.join(', ')}} from './common-types.js';

`;

  for (const msgProp of r2aMessageProps) {
    const msgName = msgProp.charAt(0).toUpperCase() + msgProp.slice(1) + 'Message';
    r2aMessageNames.push(msgName);
    const propDef = r2aJson.properties[msgProp];
    const objSchema = {
      type: 'object',
      properties: {
        version: {const: 'v1.0'},
        [msgProp]: propDef,
      },
      required: ['version', msgProp],
      additionalProperties: false,
    };
    const prep = prepareRef(objSchema, msgName);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${msgName}Schema`,
      type: msgName,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name: msgName, version: 'v1_0'});
    r2aTs += code + '\n\n';
  }

  r2aTs += `/** Union schema validating any outgoing v1.0 renderer-to-agent message envelope. */
export const RendererToAgentMessageSchema = z.union([
  ${r2aMessageNames.map(m => `${m}Schema`).join(',\n  ')},
]);
export type RendererToAgentMessage = z.infer<typeof RendererToAgentMessageSchema>;
`;

  writeFileSync(join(destDir, 'renderer-to-agent.ts'), r2aTs);

  // 4. renderer-capabilities.ts
  const rcJson = JSON.parse(readFileSync(join(specDir, 'renderer_capabilities.json'), 'utf8'));
  const v10Props = rcJson.properties['v1.0'];
  const v10Prep = prepareRef(v10Props, 'V10RendererCapabilities');
  let v10Code = jsonSchemaToZod(v10Prep, {
    module: 'esm',
    name: 'V10RendererCapabilitiesSchema',
    type: 'V10RendererCapabilities',
    noImport: true,
  });
  v10Code = transformGeneratedZodCode(v10Code, {
    name: 'V10RendererCapabilities',
    version: 'v1_0',
  });
  v10Code = v10Code.replace(/\.passthrough\(\)/g, '.strict()');

  let rcTs = getHeader('v1_0') + "import {z} from 'zod';\n\n";
  rcTs += `/** Zod schema validating the strict v1.0 protocol renderer capabilities payload. */\n`;
  rcTs += v10Code + '\n\n';
  rcTs += `/** Zod schema validating multi-version renderer capabilities maps across protocol versions. */
export const RendererCapabilitiesSchema = z.object({
  "v1.0": V10RendererCapabilitiesSchema.optional(),
  supportedCatalogIds: z.array(z.string()).optional(),
  inlineCatalogs: z.array(z.record(z.string(), z.any())).optional(),
}).catchall(z.any());
export type RendererCapabilities = z.infer<typeof RendererCapabilitiesSchema>;
`;

  writeFileSync(join(destDir, 'renderer-capabilities.ts'), rcTs);

  // 5. catalog-definition.ts
  const catalogDefJson = JSON.parse(readFileSync(join(specDir, 'catalog_definition.json'), 'utf8'));

  let catalogDefTs =
    getHeader('v1_0') +
    `import {z} from 'zod';
import {ExtensionsSchema} from './common-types.js';

`;

  for (const [name, rawDef] of Object.entries(catalogDefJson.$defs)) {
    const prep = prepareRef(rawDef, name);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${name}Schema`,
      type: name,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name, version: 'v1_0'});
    code += `\nexport type ${name}Input = z.input<typeof ${name}Schema>;`;
    catalogDefTs += code + '\n\n';
  }

  writeFileSync(join(destDir, 'catalog-definition.ts'), catalogDefTs);

  // 6. index.ts
  const indexTs =
    getHeader('v1_0') +
    `export * from './common-types.js';
export * from './agent-to-renderer.js';
export * from './renderer-to-agent.js';
export * from './renderer-capabilities.js';
export * from './catalog-definition.js';
`;

  writeFileSync(join(destDir, 'index.ts'), indexTs);
}

generateV09Schemas(rootDir);
generateV10Schemas(rootDir);
console.log('Successfully generated Zod schemas for v0.9 and v1.0.');
