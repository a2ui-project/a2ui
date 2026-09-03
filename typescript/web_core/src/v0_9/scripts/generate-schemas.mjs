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

import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  getHeader,
  analyzeDependencies,
  compileDefToZod,
  writeIndexFile,
} from '../../../scripts/zod-generator-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const v09Dir = join(__dirname, '..');
const rootDir = join(v09Dir, '..', '..');
const specDir = join(rootDir, '..', '..', 'specification', 'v0_9', 'json');
const destDir = join(v09Dir, 'schema');

const VERSION_TAG = 'v0.9';
const SCRIPT_SOURCE = 'src/v0_9/scripts/generate-schemas.mjs';

/**
 * Generates v0.9 common-types.ts.
 */
function generateCommonTypes() {
  const commonJson = JSON.parse(readFileSync(join(specDir, 'common_types.json'), 'utf8'));
  const {topologicalOrder, lazyEdges} = analyzeDependencies(commonJson.$defs);
  const recursiveSchemas = new Set([
    ...Array.from(lazyEdges).map(e => e.split('->')[0]),
    ...Array.from(lazyEdges).map(e => e.split('->')[1]),
  ]);

  let commonTs =
    getHeader(VERSION_TAG, SCRIPT_SOURCE) +
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

    let code = compileDefToZod(rawDef, name, {lazyEdges, topologicalOrder});

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
 * Generates v0.9 server-to-client.ts.
 */
function generateIncomingMessageSchemas(commonDefNames) {
  const s2cJson = JSON.parse(readFileSync(join(specDir, 'server_to_client.json'), 'utf8'));
  const s2cMsgNames = s2cJson.oneOf.map(ref => ref.$ref.replace('#/$defs/', ''));

  let bodyCode = '';

  for (const msgName of s2cMsgNames) {
    const rawDef = s2cJson.$defs[msgName];
    let code = compileDefToZod(rawDef, msgName);
    code = code.replace(/z\.literal\("v0\.9"\)/g, 'z.enum(["v0.9", "v0.9.1"])');
    bodyCode += code + '\n\n';
  }

  bodyCode += `export const A2uiMessageSchema = z.union([\n  ${s2cMsgNames.map(m => `${m}Schema`).join(',\n  ')},\n]);\n`;
  bodyCode += `export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;\n\n`;

  bodyCode += `export const A2uiMessageListSchema = z.array(A2uiMessageSchema).describe('A list of messages.');\n`;
  bodyCode += `export type A2uiMessageList = z.infer<typeof A2uiMessageListSchema>;\n\n`;
  bodyCode += `export const A2uiMessageListWrapperSchema = z\n  .object({\n    messages: A2uiMessageListSchema,\n  })\n  .strict()\n  .describe('An object wrapping a list of messages.');\n`;
  bodyCode += `export type A2uiMessageListWrapper = z.infer<typeof A2uiMessageListWrapperSchema>;\n`;

  const neededImports = Array.from(commonDefNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => bodyCode.includes(schemaName))
    .sort();

  let outTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n";
  if (neededImports.length > 0) {
    outTs += `import {${neededImports.join(', ')}} from './common-types.js';\n\n`;
  } else {
    outTs += '\n';
  }
  outTs += bodyCode;

  writeFileSync(join(destDir, 'server-to-client.ts'), outTs);
}

/**
 * Generates v0.9 client-to-server.ts.
 */
function generateOutgoingMessageSchemas() {
  const c2sJson = JSON.parse(readFileSync(join(specDir, 'client_to_server.json'), 'utf8'));
  const cdmJson = JSON.parse(readFileSync(join(specDir, 'client_data_model.json'), 'utf8'));

  let c2sTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n\n";

  let actionCode = compileDefToZod(c2sJson.properties.action, 'A2uiClientAction');
  actionCode = actionCode.replace(/\.passthrough\(\)/g, '.strict()');
  c2sTs += actionCode + '\n\n';

  const valErrorCode = compileDefToZod(c2sJson.properties.error.oneOf[0], 'A2uiValidationError', {
    emitType: false,
  });
  c2sTs += valErrorCode + '\n\n';

  let genErrorCode = compileDefToZod(c2sJson.properties.error.oneOf[1], 'A2uiGenericError', {
    emitType: false,
  });
  genErrorCode = genErrorCode.replace(
    'code: z.any()',
    "code: z.string().refine(c => c !== 'VALIDATION_FAILED')",
  );
  c2sTs += genErrorCode + '\n\n';

  c2sTs += `export const A2uiClientErrorSchema = z.union([A2uiValidationErrorSchema, A2uiGenericErrorSchema]);\nexport type A2uiClientError = z.infer<typeof A2uiClientErrorSchema>;\n\n`;

  c2sTs += `export const A2uiClientMessageSchema = z\n  .object({\n    version: z.enum(['v0.9', 'v0.9.1']),\n  })\n  .and(\n    z.union([z.object({action: A2uiClientActionSchema}), z.object({error: A2uiClientErrorSchema})]),\n  );\nexport type A2uiClientMessage = z.infer<typeof A2uiClientMessageSchema>;\n\n`;

  let cdmCode = compileDefToZod(cdmJson, 'A2uiClientDataModel');
  cdmCode = cdmCode.replace(/z\.literal\("v0\.9"\)/g, 'z.enum(["v0.9", "v0.9.1"])');
  c2sTs += cdmCode + '\n\n';

  c2sTs += `export const A2uiClientMessageListSchema = z\n  .array(A2uiClientMessageSchema)\n  .describe('A list of client messages.');\nexport type A2uiClientMessageList = z.infer<typeof A2uiClientMessageListSchema>;\n\n`;
  c2sTs += `export const A2uiClientMessageListWrapperSchema = z\n  .object({\n    messages: A2uiClientMessageListSchema,\n  })\n  .strict()\n  .describe('An object wrapping a list of client messages.');\nexport type A2uiClientMessageListWrapper = z.infer<typeof A2uiClientMessageListWrapperSchema>;\n`;

  writeFileSync(join(destDir, 'client-to-server.ts'), c2sTs);
}

/**
 * Generates v0.9 client-capabilities.ts.
 */
function generateCapabilitiesSchemas() {
  const ccJson = JSON.parse(readFileSync(join(specDir, 'client_capabilities.json'), 'utf8'));
  let ccTs =
    getHeader(VERSION_TAG, SCRIPT_SOURCE) +
    `import {z} from 'zod';\n\nexport type JsonSchema = Record<string, any>;\n\n`;

  for (const [name, def] of Object.entries(ccJson.$defs || {})) {
    const typeName = name === 'Catalog' ? 'InlineCatalog' : name;
    const code = compileDefToZod(def, typeName);
    ccTs += code + '\n\n';
  }

  let v09CapsCode = compileDefToZod(ccJson.properties['v0.9'], 'A2uiVersionCapabilities');
  v09CapsCode = v09CapsCode.replace(/CatalogSchema/g, 'InlineCatalogSchema');
  ccTs += v09CapsCode + '\n';

  writeFileSync(join(destDir, 'client-capabilities.ts'), ccTs);
}

export function generateSchemas() {
  console.log('Generating v0.9 Zod schemas dynamically from JSON specification...');
  mkdirSync(destDir, {recursive: true});

  const commonDefNames = generateCommonTypes();
  generateIncomingMessageSchemas(commonDefNames);
  generateOutgoingMessageSchemas();
  generateCapabilitiesSchemas();
  writeIndexFile(destDir, VERSION_TAG, SCRIPT_SOURCE);

  console.log('Successfully generated v0.9 Zod schemas.');
}

export const generateV09Schemas = generateSchemas;

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateSchemas();
}
