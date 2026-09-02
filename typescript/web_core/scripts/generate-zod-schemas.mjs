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

const V09_CUSTOM_SCHEMAS = {
  ComponentId: `export const ComponentIdSchema = markChildRef(
  z.string().describe('REF:#/$defs/ComponentId'),
  'component-id',
);
export type ComponentId = z.infer<typeof ComponentIdSchema>;`,

  DataBinding: `export const DataBindingSchema = z
  .object({
    'path': z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .describe('REF:#/$defs/DataBinding');
export type DataBinding = z.infer<typeof DataBindingSchema>;`,

  FunctionCall: `export const FunctionCallSchema = z
  .object({
    'call': z.string().describe('The name of the function to call.'),
    'args': z.record(z.any()).describe('Arguments passed to the function.').optional(),
    'catalogId': z
      .string()
      .describe('The catalog ID for this function, overriding any surface-level default catalogId.')
      .optional(),
  })
  .describe('REF:#/$defs/FunctionCall');
export type FunctionCall = z.infer<typeof FunctionCallSchema>;`,

  DynamicString: `export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicString');
export type DynamicString = z.infer<typeof DynamicStringSchema>;`,

  DynamicNumber: `export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicNumber');
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;`,

  DynamicBoolean: `export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicBoolean');
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;`,

  DynamicStringList: `export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicStringList');
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;`,

  DynamicValue: `export const DynamicValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    DataBindingSchema,
    z.lazy(() => FunctionCallSchema),
  ])
  .describe('REF:#/$defs/DynamicValue');
export type DynamicValue = z.infer<typeof DynamicValueSchema>;`,

  ChildList: `export const ChildListSchema = markChildRef(
  z.union([z.array(ComponentIdSchema), TemplateChildListSchema]),
  'child-list',
);
export type ChildList = z.infer<typeof ChildListSchema>;`,

  Action: `export const ActionEventSchema = z
  .object({
    'name': z.string().describe('The name of the action to be dispatched to the server.'),
    'context': z
      .record(DynamicValueSchema)
      .describe(
        'A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.',
      )
      .optional(),
  })
  .describe('REF:#/$defs/ActionEvent');

export const ActionEventWrapperSchema = z
  .object({
    'event': ActionEventSchema,
  })
  .describe('REF:#/$defs/ActionEventWrapper');

export const ActionFunctionCallWrapperSchema = z
  .object({
    'functionCall': FunctionCallSchema,
  })
  .describe('REF:#/$defs/ActionFunctionCallWrapper');

export const ActionSchema = z.union([ActionEventWrapperSchema, ActionFunctionCallWrapperSchema]).describe('REF:#/$defs/Action');
export type Action = z.infer<typeof ActionSchema>;`,

  AccessibilityAttributes: `export const AccessibilityAttributesSchema = z
  .object({
    'label': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|A short string, typically 1 to 3 words, used by assistive technologies to convey the purpose or intent of an element. For example, an input field might have an accessible label of 'User ID' or a button might be labeled 'Submit'.",
    ).optional(),
    'description': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|Additional information provided by assistive technologies about an element such as instructions, format requirements, or result of an action. For example, a mute button might have a label of 'Mute' and a description of 'Silences notifications about this conversation'.",
    ).optional(),
  })
  .describe('REF:#/$defs/AccessibilityAttributes');
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;`,
};

/**
 * Handles type-specific overrides and constraints.
 *
 * @param {string} code Cleaned code.
 * @param {object} options Metadata options.
 * @returns {string} Modified code.
 */
function applyNameSpecificFixups(code, options = {}) {
  if (options.version === 'v0_9' && V09_CUSTOM_SCHEMAS[options.name]) {
    return V09_CUSTOM_SCHEMAS[options.name];
  }

  let clean = code;

  if (options.name === 'DynamicValue' && options.version === 'v1_0') {
    clean = clean.replace(
      'z.record(z.string(), z.any())',
      "z.record(z.string(), z.any()).refine((obj) => !obj || (!('path' in obj) && !('call' in obj)))",
    );
  }

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

  if (options.name === 'Extensions') {
    clean = `export const ExtensionsSchema = z.record(z.string(), z.any()).describe("Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.");
export type Extensions = z.infer<typeof ExtensionsSchema>;`;
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
 * Builds a topological ordering of schema definition names.
 *
 * @param {Record<string, object>} defs Map of definition names to JSON Schema objects.
 * @returns {string[]} Topologically sorted definition names.
 */
function buildTopologicalOrder(defs) {
  const graph = new Map();
  for (const [name, def] of Object.entries(defs)) {
    const deps = getDependencies(def);
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
  return topologicalOrder;
}

/**
 * Resolves a $ref pointer to an AST placeholder or Zod lazy wrapper.
 *
 * @param {string} refString The $ref pointer string.
 * @param {string} parentDefName The enclosing definition name.
 * @returns {object|null} Modified JSON Schema node or null.
 */
function resolveRefTarget(refString, parentDefName) {
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
  if (parentDefName === 'DynamicValue' && targetName === 'FunctionCall') {
    return {enum: ['__REF__z.lazy(() => FunctionCallSchema)__']};
  }
  return {enum: ['__REF__' + targetName + 'Schema__']};
}

/**
 * Helper to recursively prepare JSON Schema nodes by resolving local/remote #/$defs references.
 *
 * @param {object} node Schema node.
 * @param {string} parentDefName Enclosing definition name.
 * @returns {object} Prepared schema node.
 */
function prepareRef(node, parentDefName) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(n => prepareRef(n, parentDefName));
  if (typeof node.$ref === 'string') {
    const resolved = resolveRefTarget(node.$ref, parentDefName);
    if (resolved) return resolved;
  }
  const res = {};
  for (const [k, v] of Object.entries(node)) {
    res[k] = prepareRef(v, parentDefName);
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
  const topologicalOrder = buildTopologicalOrder(commonJson.$defs);

  let commonTs = getHeader(version) + "import {z} from 'zod';\n\n";

  if (prefixCode) {
    commonTs += prefixCode + '\n\n';
  }

  const defKeys = [
    ...topologicalOrder.filter(k => k in commonJson.$defs),
    ...Object.keys(commonJson.$defs).filter(k => !topologicalOrder.includes(k)),
  ];

  for (const name of defKeys) {
    const rawDef = commonJson.$defs[name];
    const prep = prepareRef(rawDef, name);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${name}Schema`,
      type: name,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name, version});
    commonTs += code + '\n\n';
  }

  if (suffixCode) {
    commonTs += suffixCode + '\n';
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
  return (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef;
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

export const CommonSchemas = {
  ComponentId: ComponentIdSchema,
  ChildList: ChildListSchema,
  DataBinding: DataBindingSchema,
  DynamicValue: DynamicValueSchema,
  DynamicString: DynamicStringSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicBoolean: DynamicBooleanSchema,
  DynamicStringList: DynamicStringListSchema,
  FunctionCall: FunctionCallSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  Action: ActionSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
  AnyComponent: AnyComponentSchema,
};
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
  const s2cMsgNames = [
    'CreateSurfaceMessage',
    'UpdateComponentsMessage',
    'UpdateDataModelMessage',
    'DeleteSurfaceMessage',
  ];

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
  CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema,
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
  const c2sTs =
    getHeader('v0_9') +
    `import {z} from 'zod';

export const A2uiClientActionSchema = z
  .object({
    name: z
      .string()
      .describe("The name of the action, taken from the component's action.event.name property."),
    surfaceId: z.string().describe('The id of the surface where the event originated.'),
    sourceComponentId: z.string().describe('The id of the component that triggered the event.'),
    timestamp: z.string().datetime().describe('An ISO 8601 timestamp of when the event occurred.'),
    context: z
      .record(z.any())
      .describe(
        "A JSON object containing the key-value pairs from the component's action.event.context, after resolving all data bindings.",
      ),
  })
  .strict();

export const A2uiValidationErrorSchema = z
  .object({
    code: z.literal('VALIDATION_FAILED'),
    surfaceId: z.string().describe('The id of the surface where the error occurred.'),
    path: z
      .string()
      .describe(
        "The JSON pointer to the field that failed validation (e.g. '/components/0/text').",
      ),
    message: z
      .string()
      .describe('A short one or two sentence description of why validation failed.'),
  })
  .strict();

export const A2uiGenericErrorSchema = z
  .object({
    code: z.string().refine(c => c !== 'VALIDATION_FAILED'),
    message: z
      .string()
      .describe('A short one or two sentence description of why the error occurred.'),
    surfaceId: z.string().describe('The id of the surface where the error occurred.'),
  })
  .passthrough();

export const A2uiClientErrorSchema = z.union([A2uiValidationErrorSchema, A2uiGenericErrorSchema]);

export const A2uiClientMessageSchema = z
  .object({
    version: z.enum(['v0.9', 'v0.9.1']),
  })
  .and(
    z.union([z.object({action: A2uiClientActionSchema}), z.object({error: A2uiClientErrorSchema})]),
  );

export const A2uiClientDataModelSchema = z
  .object({
    version: z.enum(['v0.9', 'v0.9.1']),
    surfaces: z
      .record(z.object({}).passthrough())
      .describe('A map of surface IDs to their current data models.'),
  })
  .strict();

export type A2uiClientAction = z.infer<typeof A2uiClientActionSchema>;
export type A2uiClientError = z.infer<typeof A2uiClientErrorSchema>;
export type A2uiClientMessage = z.infer<typeof A2uiClientMessageSchema>;
export type A2uiClientDataModel = z.infer<typeof A2uiClientDataModelSchema>;

export const A2uiClientMessageListSchema = z
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
  const ccTs =
    getHeader('v0_9') +
    `export type JsonSchema = Record<string, any>;

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: JsonSchema;
  returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
}

export interface InlineCatalog {
  catalogId: string;
  components?: Record<string, JsonSchema>;
  functions?: FunctionDefinition[];
  theme?: Record<string, JsonSchema>;
}

export interface A2uiVersionCapabilities {
  supportedCatalogIds: string[];
  inlineCatalogs?: InlineCatalog[];
}

export type A2uiClientCapabilities =
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
  const commonDefNames = generateCommonTypes(specDir, destDir, 'v1_0');

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
  if (rcJson?.properties?.['v1.0']?.properties?.inlineCatalogs?.items?.$ref) {
    rcJson.properties['v1.0'].properties.inlineCatalogs.items = {
      type: 'object',
      additionalProperties: true,
    };
  }

  const rcTs =
    getHeader('v1_0') +
    `import {z} from 'zod';

/** Zod schema validating the strict v1.0 protocol renderer capabilities payload. */
export const V10RendererCapabilitiesSchema = z.object({
  supportedCatalogIds: z.array(z.string()).describe("An array of string identifiers for each of the component and function catalogs supported by the renderer."),
  inlineCatalogs: z.array(z.record(z.string(), z.any())).describe("An array of inline catalog definitions.").optional(),
}).strict();
export type V10RendererCapabilities = z.infer<typeof V10RendererCapabilitiesSchema>;

/** Zod schema validating multi-version renderer capabilities maps across protocol versions. */
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
