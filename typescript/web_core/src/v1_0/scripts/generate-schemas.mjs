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

    if (name === 'DynamicValue') {
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
 * Generates v1.0 catalog-definition.ts.
 */
function generateCatalogDefinition(commonDefNames) {
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

  const neededImports = Array.from(commonDefNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => bodyCode.includes(schemaName))
    .sort();

  let catalogDefTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n";
  if (neededImports.length > 0) {
    catalogDefTs += `import {${neededImports.join(', ')}} from './common-types.js';\n\n`;
  } else {
    catalogDefTs += '\n';
  }
  catalogDefTs += bodyCode;

  writeFileSync(join(destDir, 'catalog-definition.ts'), catalogDefTs);
}

/**
 * Generates v1.0 agent-to-renderer.ts.
 */
function generateIncomingMessageSchemas(commonDefNames) {
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

  const neededImports = Array.from(commonDefNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => bodyCode.includes(schemaName))
    .sort();

  let a2rTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n";
  if (neededImports.length > 0) {
    a2rTs += `import {${neededImports.join(', ')}} from './common-types.js';\n\n`;
  } else {
    a2rTs += '\n';
  }
  a2rTs += bodyCode;

  writeFileSync(join(destDir, 'agent-to-renderer.ts'), a2rTs);
}

/**
 * Generates v1.0 renderer-to-agent.ts.
 */
function generateOutgoingMessageSchemas(commonDefNames) {
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

  const neededImports = Array.from(commonDefNames)
    .map(name => `${name}Schema`)
    .filter(schemaName => bodyCode.includes(schemaName))
    .sort();

  let r2aTs = getHeader(VERSION_TAG, SCRIPT_SOURCE) + "import {z} from 'zod';\n";
  if (neededImports.length > 0) {
    r2aTs += `import {${neededImports.join(', ')}} from './common-types.js';\n\n`;
  } else {
    r2aTs += '\n';
  }
  r2aTs += bodyCode;

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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateSchemas();
}
