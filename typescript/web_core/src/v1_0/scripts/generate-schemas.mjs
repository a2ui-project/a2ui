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
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  getHeader,
  analyzeDependencies,
  compileDefToZod,
  writeIndexFile,
} from '../../../scripts/zod-generator-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const v10Dir = join(__dirname, '..');
const rootDir = join(v10Dir, '..', '..');
const specDir = join(rootDir, '..', '..', 'specification', 'v1_0', 'json');
const destDir = join(v10Dir, 'schema');

const VERSION_TAG = 'v1.0';
const SCRIPT_SOURCE = 'src/v1_0/scripts/generate-schemas.mjs';

/**
 * Generates v1.0 common-types.ts.
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
    } else if (name === 'DataBinding') {
      code = `export const DataBindingSchema = z
  .object({
    '@path': z.string().describe('A JSON Pointer path to a value in the data model.').optional(),
    'path': z.string().describe('A JSON Pointer path to a value in the data model.').optional(),
  })
  .refine(data => data['@path'] !== undefined || data.path !== undefined, {
    message: "Either '@path' or 'path' must be provided.",
  })
  .describe('REF:#/$defs/DataBinding');
export type DataBinding = z.infer<typeof DataBindingSchema>;`;
    } else if (name === 'FunctionCommon') {
      code = `export const FunctionCommonSchema = z
  .object({
    '@call': z.string().describe('The name of the function to call.').optional(),
    'call': z.string().describe('The name of the function to call.').optional(),
    'catalogId': z
      .string()
      .describe('The catalog ID for this function, overriding any surface-level default catalogId.')
      .optional(),
  })
  .refine(data => data['@call'] !== undefined || data.call !== undefined, {
    message: "Either '@call' or 'call' must be provided.",
  })
  .describe(
    "REF:#/$defs/FunctionCommon|Baseline envelope properties common to all function calls. Function-specific argument schemas ('args') are defined individually by each function in the active catalog.",
  );
export type FunctionCommon = z.infer<typeof FunctionCommonSchema>;`;
    } else if (name === 'IndexSystemFunction') {
      code = `export const IndexSystemFunctionSchema = z
  .object({
    '@call': z.literal('@index').optional(),
    'call': z.literal('@index').optional(),
    'args': z.object({'offset': DynamicNumberSchema.optional()}).optional(),
  })
  .refine(data => data['@call'] !== undefined || data.call !== undefined, {
    message: "Either '@call' or 'call' must be '@index'.",
  })
  .describe('REF:#/$defs/IndexSystemFunction');
export type IndexSystemFunction = z.infer<typeof IndexSystemFunctionSchema>;`;
    }

    if (recursiveSchemas.has(name)) {
      if (name === 'FunctionCall') {
        code =
          `export interface FunctionCall {\n  call?: string;\n  '@call'?: string;\n  args?: Record<string, unknown>;\n  returnType?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';\n}\n` +
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
          `export type DynamicValue = string | number | boolean | unknown[] | DataBinding | FunctionCall | Record<string, unknown>;\n` +
          code;
        code = code.replace(
          'export const DynamicValueSchema =',
          'export const DynamicValueSchema: z.ZodType<DynamicValue> =',
        );
        code = code.replace(
          new RegExp(`\\n?export type ${name} = z\\.infer<typeof ${name}Schema>;?`),
          '',
        );
      }
    }

    if (name === 'DynamicValue') {
      code = code.replace(
        'z.record(z.string(), z.any())',
        "z.record(z.string(), z.unknown()).refine((obj) => !obj || (!('@path' in obj) && !('path' in obj) && !('@call' in obj) && !('call' in obj)))",
      );
    }

    if (name === 'Extensions') {
      code = `export const ExtensionsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const key in value) {
      if (!key.match(/^[\\p{XID_Start}_][\\p{XID_Continue}:-]*$/u)) {
        ctx.addIssue({
          path: [key],
          code: z.ZodIssueCode.custom,
          message: \`Invalid extension key "\${key}": Keys MUST be Unicode identifiers (UAX #31).\`,
        });
      }
    }
  })
  .describe(
    "REF:#/$defs/Extensions|Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.",
  );
export type Extensions = z.infer<typeof ExtensionsSchema>;`;
    }

    if (name === 'FunctionResponse') {
      code = `export const FunctionResponseSchema = z
  .object({
    'functionCallId': CallIdSchema,
    'value': z.any().describe('The return value of the function.').optional(),
    'error': z
      .object({'code': z.string(), 'message': z.string()})
      .strict()
      .describe('An error object indicating failure of the function execution.')
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasValue = 'value' in val;
    const hasError = 'error' in val;
    if ((hasValue && hasError) || (!hasValue && !hasError)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FunctionResponse must have either "value" or "error", but not both or neither.',
      });
    }
  })
  .describe(
    'REF:#/$defs/FunctionResponse|The return response matching a callAgentFunction or callRendererFunction invocation.',
  );
export type FunctionResponse = z.infer<typeof FunctionResponseSchema>;`;
    }

    commonTs += code + '\n\n';
  }

  const commonEntries = defKeys.map(k => `  ${k}: ${k}Schema,`).join('\n');
  commonTs += `export const CommonSchemas = {\n${commonEntries}\n};\n\n`;

  writeFileSync(join(destDir, 'common-types.ts'), commonTs);

  const pureCommonNames = new Set(Object.keys(commonJson.$defs));
  const helperNames = new Set();
  const helpersPath = join(destDir, 'helpers.ts');
  if (existsSync(helpersPath)) {
    const helpersContent = readFileSync(helpersPath, 'utf8');
    const matches = helpersContent.matchAll(/export\s+const\s+([A-Za-z0-9_]+Schema)/g);
    for (const m of matches) {
      helperNames.add(m[1].replace(/Schema$/, ''));
    }
  }
  return {pureCommonNames, helperNames};
}

/**
 * Generates v1.0 catalog-definition.ts.
 */
function generateCatalogDefinition({pureCommonNames, helperNames}) {
  const catalogDefJson = JSON.parse(readFileSync(join(specDir, 'catalog_definition.json'), 'utf8'));
  let bodyCode = '';

  for (const [name, rawDef] of Object.entries(catalogDefJson.$defs || {})) {
    let code = compileDefToZod(rawDef, name);

    // catalog_definition.json specifies that requiresUserActivation=true requires allowedCallers='rendererOnly'
    if (name === 'FunctionDefinition') {
      code = code.replace(
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

    code += `\nexport type ${name}Input = z.input<typeof ${name}Schema>;`;
    bodyCode += code + '\n\n';
  }

  const commonImports = Array.from(pureCommonNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => new RegExp('\\b' + schemaName + '\\b').test(bodyCode))
    .sort();
  const helperImports = Array.from(helperNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => new RegExp('\\b' + schemaName + '\\b').test(bodyCode))
    .sort();

  let catalogDefTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n";
  if (commonImports.length > 0) {
    catalogDefTs += `import {${commonImports.join(', ')}} from './common-types.js';\n`;
  }
  if (helperImports.length > 0) {
    catalogDefTs += `import {${helperImports.join(', ')}} from './helpers.js';\n`;
  }
  catalogDefTs += '\n' + bodyCode;

  writeFileSync(join(destDir, 'catalog-definition.ts'), catalogDefTs);
}

/**
 * Generates v1.0 agent-to-renderer.ts.
 */
function generateIncomingMessageSchemas({pureCommonNames, helperNames}) {
  const a2rJson = JSON.parse(readFileSync(join(specDir, 'agent_to_renderer.json'), 'utf8'));
  const a2rMsgNames = a2rJson.oneOf.map(ref => ref.$ref.replace('#/$defs/', ''));

  let bodyCode = '';

  for (const msgName of a2rMsgNames) {
    const rawDef = a2rJson.$defs[msgName];
    const code = compileDefToZod(rawDef, msgName);
    bodyCode += code + '\n\n';
  }

  bodyCode += `export const AgentToRendererMessageSchema = z.union([\n  ${a2rMsgNames.map(m => `${m}Schema`).join(',\n  ')},\n]);\n`;
  bodyCode += `export type AgentToRendererMessage = z.infer<typeof AgentToRendererMessageSchema>;\n`;

  const commonImports = Array.from(pureCommonNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => new RegExp('\\b' + schemaName + '\\b').test(bodyCode))
    .sort();
  const helperImports = Array.from(helperNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => new RegExp('\\b' + schemaName + '\\b').test(bodyCode))
    .sort();

  let a2rTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n";
  if (commonImports.length > 0) {
    a2rTs += `import {${commonImports.join(', ')}} from './common-types.js';\n`;
  }
  if (helperImports.length > 0) {
    a2rTs += `import {${helperImports.join(', ')}} from './helpers.js';\n`;
  }
  a2rTs += '\n' + bodyCode;

  writeFileSync(join(destDir, 'agent-to-renderer.ts'), a2rTs);
}

/**
 * Generates v1.0 renderer-to-agent.ts.
 */
function generateOutgoingMessageSchemas({pureCommonNames, helperNames}) {
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
    const code = compileDefToZod(objSchema, msgName);
    bodyCode += code + '\n\n';
  }

  bodyCode += `/** Union schema validating any outgoing v1.0 renderer-to-agent message envelope. */\n`;
  bodyCode += `export const RendererToAgentMessageSchema = z.union([\n  ${r2aMessageNames.map(m => `${m}Schema`).join(',\n  ')},\n]);\n`;
  bodyCode += `export type RendererToAgentMessage = z.infer<typeof RendererToAgentMessageSchema>;\n`;

  const commonImports = Array.from(pureCommonNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => new RegExp('\\b' + schemaName + '\\b').test(bodyCode))
    .sort();
  const helperImports = Array.from(helperNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => new RegExp('\\b' + schemaName + '\\b').test(bodyCode))
    .sort();

  let r2aTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n";
  if (commonImports.length > 0) {
    r2aTs += `import {${commonImports.join(', ')}} from './common-types.js';\n`;
  }
  if (helperImports.length > 0) {
    r2aTs += `import {${helperImports.join(', ')}} from './helpers.js';\n`;
  }
  r2aTs += '\n' + bodyCode;

  writeFileSync(join(destDir, 'renderer-to-agent.ts'), r2aTs);
}

/**
 * Generates v1.0 renderer-capabilities.ts.
 */
function generateCapabilitiesSchemas() {
  const rcJson = JSON.parse(readFileSync(join(specDir, 'renderer_capabilities.json'), 'utf8'));
  const v10Props = rcJson.properties['v1.0'];
  let v10Code = compileDefToZod(v10Props, 'V10RendererCapabilities');
  v10Code = v10Code.replace(/\.passthrough\(\)/g, '.strict()');

  let rcTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n\n";
  rcTs += `/** Zod schema validating the strict v1.0 protocol renderer capabilities payload. */\n`;
  rcTs += v10Code + '\n';

  writeFileSync(join(destDir, 'renderer-capabilities.ts'), rcTs);
}

export function generateSchemas() {
  console.log('Generating v1.0 Zod schemas dynamically from JSON specification...');
  mkdirSync(destDir, {recursive: true});

  const commonDefNames = generateCommonTypes();
  generateCatalogDefinition(commonDefNames);
  generateIncomingMessageSchemas(commonDefNames);
  generateOutgoingMessageSchemas(commonDefNames);
  generateCapabilitiesSchemas();
  writeIndexFile(destDir, VERSION_TAG, SCRIPT_SOURCE);

  console.log('Successfully generated v1.0 Zod schemas.');
}

export const generateV10Schemas = generateSchemas;

// Allow direct execution
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateSchemas();
}
