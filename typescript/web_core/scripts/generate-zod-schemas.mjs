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

import {readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {jsonSchemaToZod} from 'json-schema-to-zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const specBaseDir = join(rootDir, '..', '..', 'specification');

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
  if (
    Array.isArray(node.allOf) &&
    node.allOf.length === 2 &&
    node.allOf.some(item => item.$ref && item.$ref.includes('FunctionCall')) &&
    node.allOf.some(item => item.properties && item.properties.returnType)
  ) {
    const fnRef = node.allOf.find(item => item.$ref && item.$ref.includes('FunctionCall'));
    return prepareRef(fnRef, parentDefName, lazyEdges, topologicalOrder);
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
  if (res.properties && !res.type) {
    res.type = 'object';
  }
  if (node.const !== undefined && typeof node.const !== 'object' && !res.enum) {
    res.type = typeof node.const;
    res.enum = [node.const];
    delete res.const;
  }
  return res;
}

/**
 * Generates common-types.ts for a given specification version.
 *
 * @param {string} specDir Specification directory.
 * @param {string} destDir Destination directory.
 * @param {string} version Version tag.
 * @returns {Set<string>} Set of definition names generated.
 */
function generateCommonTypes(specDir, destDir, version) {
  const commonJson = JSON.parse(readFileSync(join(specDir, 'common_types.json'), 'utf8'));
  const {topologicalOrder, lazyEdges} = analyzeDependencies(commonJson.$defs);
  const recursiveSchemas = new Set([
    ...Array.from(lazyEdges).map(e => e.split('->')[0]),
    ...Array.from(lazyEdges).map(e => e.split('->')[1]),
  ]);

  let commonTs =
    getHeader(version) +
    "import {z} from 'zod';\n" +
    "import {markChildRef} from '../../types/child-ref-helpers.js';\n\n";

  const defKeys = [
    ...topologicalOrder.filter(k => k in commonJson.$defs),
    ...Object.keys(commonJson.$defs).filter(k => !topologicalOrder.includes(k)),
  ];

  for (const name of defKeys) {
    const rawDef = JSON.parse(JSON.stringify(commonJson.$defs[name]));
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
      if (name === 'FunctionCall') {
        code =
          `export interface FunctionCall {\n  call: string;\n  args?: Record<string, any>;\n  returnType?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';\n}\n` +
          code;
        code = code.replace(
          'export const FunctionCallSchema =',
          'export const FunctionCallSchema: z.ZodType<FunctionCall> =',
        );
        code = code.replace(
          new RegExp(`\\n?export type ${name} = z\\.infer<typeof ${name}Schema>;?`),
          '',
        );
      } else if (name === 'DynamicValue') {
        code =
          `export type DynamicValue = string | number | boolean | any[] | DataBinding | FunctionCall | Record<string, any>;\n` +
          code;
        code = code.replace(
          'export const DynamicValueSchema =',
          'export const DynamicValueSchema: z.ZodType<DynamicValue> =',
        );
        code = code.replace(
          new RegExp(`\\n?export type ${name} = z\\.infer<typeof ${name}Schema>;?`),
          '',
        );
      } else {
        code = code.replace(
          new RegExp(`export const ${name}Schema =`),
          `export const ${name}Schema: z.ZodType<any> =`,
        );
      }
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

  const commonEntries = defKeys.map(k => `  ${k}: ${k}Schema,`).join('\n');
  commonTs += `export const CommonSchemas = {\n${commonEntries}\n};\n\n`;
  commonTs += `export * from './helpers.js';\n`;

  writeFileSync(join(destDir, 'common-types.ts'), commonTs);

  const allExportNames = new Set(Object.keys(commonJson.$defs));
  const helpersPath = join(destDir, 'helpers.ts');
  if (existsSync(helpersPath)) {
    const helpersContent = readFileSync(helpersPath, 'utf8');
    const matches = helpersContent.matchAll(/export\s+const\s+([A-Za-z0-9_]+Schema)/g);
    for (const m of matches) {
      allExportNames.add(m[1].replace(/Schema$/, ''));
    }
  }
  return allExportNames;
}

/**
 * Generates catalog-definition.ts if catalog_definition.json exists.
 *
 * @param {string} specDir Specification directory.
 * @param {string} destDir Destination directory.
 * @param {string} version Version tag.
 * @param {Set<string>} commonDefNames Set of definition names in common_types.json.
 */
function generateCatalogDefinition(specDir, destDir, version, commonDefNames) {
  const filePath = join(specDir, 'catalog_definition.json');
  if (!existsSync(filePath)) return;

  const catalogDefJson = JSON.parse(readFileSync(filePath, 'utf8'));
  let bodyCode = '';

  for (const [name, rawDef] of Object.entries(catalogDefJson.$defs || {})) {
    const prep = prepareRef(rawDef, name);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${name}Schema`,
      type: name,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name, version});
    code += `\nexport type ${name}Input = z.input<typeof ${name}Schema>;`;
    bodyCode += code + '\n\n';
  }

  const neededImports = Array.from(commonDefNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => bodyCode.includes(schemaName))
    .sort();

  let catalogDefTs = getHeader(version) + "import {z} from 'zod';\n";
  if (neededImports.length > 0) {
    catalogDefTs += `import {${neededImports.join(', ')}} from './common-types.js';\n\n`;
  } else {
    catalogDefTs += '\n';
  }
  catalogDefTs += bodyCode;

  writeFileSync(join(destDir, 'catalog-definition.ts'), catalogDefTs);
}

/**
 * Generates inbound/incoming server-to-client or agent-to-renderer message schemas.
 *
 * @param {string} specDir Specification directory.
 * @param {string} destDir Destination directory.
 * @param {string} version Version tag.
 * @param {Set<string>} commonDefNames Set of definition names in common_types.json.
 */
function generateIncomingMessageSchemas(specDir, destDir, version, commonDefNames) {
  const isV10 = existsSync(join(specDir, 'agent_to_renderer.json'));
  const fileName = isV10 ? 'agent_to_renderer.json' : 'server_to_client.json';
  const outFileName = isV10 ? 'agent-to-renderer.ts' : 'server-to-client.ts';
  const unionName = isV10 ? 'AgentToRendererMessage' : 'A2uiMessage';

  const s2cJson = JSON.parse(readFileSync(join(specDir, fileName), 'utf8'));
  const s2cMsgNames = s2cJson.oneOf.map(ref => ref.$ref.replace('#/$defs/', ''));

  let bodyCode = '';

  for (const msgName of s2cMsgNames) {
    const rawDef = s2cJson.$defs[msgName];
    const prep = prepareRef(rawDef, msgName);
    let code = jsonSchemaToZod(prep, {
      module: 'esm',
      name: `${msgName}Schema`,
      type: msgName,
      noImport: true,
    });
    code = transformGeneratedZodCode(code, {name: msgName, version});
    if (!isV10) {
      code = code.replace(/z\.literal\("v0\.9"\)/g, 'z.enum(["v0.9", "v0.9.1"])');
    }
    bodyCode += code + '\n\n';
  }

  bodyCode += `export const ${unionName}Schema = z.union([\n  ${s2cMsgNames.map(m => `${m}Schema`).join(',\n  ')},\n]);\n`;
  bodyCode += `export type ${unionName} = z.infer<typeof ${unionName}Schema>;\n\n`;

  if (!isV10) {
    bodyCode += `export const A2uiMessageListSchema = z.array(A2uiMessageSchema).describe('A list of messages.');\n`;
    bodyCode += `export type A2uiMessageList = z.infer<typeof A2uiMessageListSchema>;\n\n`;
    bodyCode += `export const A2uiMessageListWrapperSchema = z\n  .object({\n    messages: A2uiMessageListSchema,\n  })\n  .strict()\n  .describe('An object wrapping a list of messages.');\n`;
    bodyCode += `export type A2uiMessageListWrapper = z.infer<typeof A2uiMessageListWrapperSchema>;\n`;
  }

  const neededImports = Array.from(commonDefNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => bodyCode.includes(schemaName))
    .sort();

  let outTs = getHeader(version) + "import {z} from 'zod';\n";
  if (neededImports.length > 0) {
    outTs += `import {${neededImports.join(', ')}} from './common-types.js';\n\n`;
  } else {
    outTs += '\n';
  }
  outTs += bodyCode;

  writeFileSync(join(destDir, outFileName), outTs);
}

/**
 * Generates outbound client-to-server or renderer-to-agent message schemas.
 *
 * @param {string} specDir Specification directory.
 * @param {string} destDir Destination directory.
 * @param {string} version Version tag.
 * @param {Set<string>} commonDefNames Set of definition names in common_types.json.
 */
function generateOutgoingMessageSchemas(specDir, destDir, version, commonDefNames) {
  const isV10 = existsSync(join(specDir, 'renderer_to_agent.json'));

  if (isV10) {
    const r2aJson = JSON.parse(readFileSync(join(specDir, 'renderer_to_agent.json'), 'utf8'));
    const r2aMessageProps = r2aJson.oneOf.map(item => item.required.find(k => k !== 'version'));
    const r2aMessageNames = [];
    let bodyCode = '';

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
      bodyCode += code + '\n\n';
    }

    bodyCode += `/** Union schema validating any outgoing v1.0 renderer-to-agent message envelope. */\n`;
    bodyCode += `export const RendererToAgentMessageSchema = z.union([\n  ${r2aMessageNames.map(m => `${m}Schema`).join(',\n  ')},\n]);\n`;
    bodyCode += `export type RendererToAgentMessage = z.infer<typeof RendererToAgentMessageSchema>;\n`;

    const neededImports = Array.from(commonDefNames)
      .map(name => `${name}Schema`)
      .filter(schemaName => bodyCode.includes(schemaName))
      .sort();

    let r2aTs = getHeader(version) + "import {z} from 'zod';\n";
    if (neededImports.length > 0) {
      r2aTs += `import {${neededImports.join(', ')}} from './common-types.js';\n\n`;
    } else {
      r2aTs += '\n';
    }
    r2aTs += bodyCode;

    writeFileSync(join(destDir, 'renderer-to-agent.ts'), r2aTs);
  } else {
    const c2sJson = JSON.parse(readFileSync(join(specDir, 'client_to_server.json'), 'utf8'));
    const cdmJson = JSON.parse(readFileSync(join(specDir, 'client_data_model.json'), 'utf8'));

    let c2sTs = getHeader(version) + "import {z} from 'zod';\n\n";

    const actionPrep = prepareRef(c2sJson.properties.action, 'A2uiClientAction');
    let actionCode = jsonSchemaToZod(actionPrep, {
      module: 'esm',
      name: 'A2uiClientActionSchema',
      type: 'A2uiClientAction',
      noImport: true,
    });
    actionCode = transformGeneratedZodCode(actionCode, {
      name: 'A2uiClientAction',
      version: 'v0_9',
    });
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

    c2sTs += `export const A2uiClientMessageSchema = z\n  .object({\n    version: z.enum(['v0.9', 'v0.9.1']),\n  })\n  .and(\n    z.union([z.object({action: A2uiClientActionSchema}), z.object({error: A2uiClientErrorSchema})]),\n  );\nexport type A2uiClientMessage = z.infer<typeof A2uiClientMessageSchema>;\n\n`;

    const cdmPrep = prepareRef(cdmJson, 'A2uiClientDataModel');
    let cdmCode = jsonSchemaToZod(cdmPrep, {
      module: 'esm',
      name: 'A2uiClientDataModelSchema',
      type: 'A2uiClientDataModel',
      noImport: true,
    });
    cdmCode = transformGeneratedZodCode(cdmCode, {
      name: 'A2uiClientDataModel',
      version: 'v0_9',
    });
    cdmCode = cdmCode.replace(/z\.literal\("v0\.9"\)/g, 'z.enum(["v0.9", "v0.9.1"])');
    c2sTs += cdmCode + '\n\n';

    c2sTs += `export const A2uiClientMessageListSchema = z\n  .array(A2uiClientMessageSchema)\n  .describe('A list of client messages.');\nexport type A2uiClientMessageList = z.infer<typeof A2uiClientMessageListSchema>;\n\n`;
    c2sTs += `export const A2uiClientMessageListWrapperSchema = z\n  .object({\n    messages: A2uiClientMessageListSchema,\n  })\n  .strict()\n  .describe('An object wrapping a list of client messages.');\nexport type A2uiClientMessageListWrapper = z.infer<typeof A2uiClientMessageListWrapperSchema>;\n`;

    writeFileSync(join(destDir, 'client-to-server.ts'), c2sTs);
  }
}

/**
 * Generates capabilities schemas (client-capabilities.ts or renderer-capabilities.ts).
 *
 * @param {string} specDir Specification directory.
 * @param {string} destDir Destination directory.
 * @param {string} version Version tag.
 */
function generateCapabilitiesSchemas(specDir, destDir, version) {
  const isV10 = existsSync(join(specDir, 'renderer_capabilities.json'));
  if (isV10) {
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

    let rcTs = getHeader(version) + "import {z} from 'zod';\n\n";
    rcTs += `/** Zod schema validating the strict v1.0 protocol renderer capabilities payload. */\n`;
    rcTs += v10Code + '\n';

    writeFileSync(join(destDir, 'renderer-capabilities.ts'), rcTs);
  } else {
    const ccJson = JSON.parse(readFileSync(join(specDir, 'client_capabilities.json'), 'utf8'));
    let ccTs =
      getHeader(version) +
      `import {z} from 'zod';\n\nexport type JsonSchema = Record<string, any>;\n\n`;

    for (const [name, def] of Object.entries(ccJson.$defs || {})) {
      const typeName = name === 'Catalog' ? 'InlineCatalog' : name;
      const prep = prepareRef(def, name);
      let code = jsonSchemaToZod(prep, {
        module: 'esm',
        name: `${typeName}Schema`,
        type: typeName,
        noImport: true,
      });
      code = transformGeneratedZodCode(code, {name: typeName, version});
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
      version,
    });
    v09CapsCode = v09CapsCode.replace(/CatalogSchema/g, 'InlineCatalogSchema');
    ccTs += v09CapsCode + '\n';

    writeFileSync(join(destDir, 'client-capabilities.ts'), ccTs);
  }
}

/**
 * Generates all schema files dynamically for a given specification version.
 *
 * @param {string} specDir Specification directory.
 * @param {string} destDir Destination schema directory.
 * @param {string} version Version tag (e.g. 'v0_9', 'v1_0').
 */
function generateVersionSchemas(specDir, destDir, version) {
  console.log(`Generating ${version} Zod schemas dynamically from JSON specification files...`);
  mkdirSync(destDir, {recursive: true});

  // 1. common-types.ts
  const commonDefNames = generateCommonTypes(specDir, destDir, version);

  // 2. catalog-definition.ts (if present)
  generateCatalogDefinition(specDir, destDir, version, commonDefNames);

  // 3. Inbound message schemas (server-to-client.ts or agent-to-renderer.ts)
  generateIncomingMessageSchemas(specDir, destDir, version, commonDefNames);

  // 4. Outbound message schemas (client-to-server.ts or renderer-to-agent.ts)
  generateOutgoingMessageSchemas(specDir, destDir, version, commonDefNames);

  // 5. Capabilities schemas (client-capabilities.ts or renderer-capabilities.ts)
  generateCapabilitiesSchemas(specDir, destDir, version);

  // 6. index.ts
  const generatedFiles = readdirSync(destDir)
    .filter(f => f.endsWith('.ts') && f !== 'index.ts' && f !== 'helpers.ts')
    .sort();

  let indexTs = getHeader(version);
  for (const file of generatedFiles) {
    indexTs += `export * from './${file.replace('.ts', '.js')}';\n`;
  }
  indexTs += `export * from './helpers.js';\n`;

  writeFileSync(join(destDir, 'index.ts'), indexTs);
}

// Discover all specification versions dynamically for active codebases
const versions = readdirSync(specBaseDir)
  .filter(
    v =>
      v.startsWith('v') &&
      existsSync(join(specBaseDir, v, 'json')) &&
      existsSync(join(rootDir, 'src', v)) &&
      v !== 'v0_8',
  )
  .sort();

for (const version of versions) {
  const specDir = join(specBaseDir, version, 'json');
  const destDir = join(rootDir, 'src', version, 'schema');
  generateVersionSchemas(specDir, destDir, version);
}

console.log(`Successfully generated Zod schemas dynamically for versions: ${versions.join(', ')}.`);
