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
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {jsonSchemaToZod} from 'json-schema-to-zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const specDir = join(rootDir, '..', '..', 'specification', 'v1_0', 'json');
const destDir = join(rootDir, 'src', 'v1_0', 'schema');

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
// Generated from specification/v1_0/json/ via scripts/generate-zod-schemas.mjs
`;

console.log('Generating v1.0 Zod schemas from JSON specification files...');

// 1. common-types.ts
const commonJson = JSON.parse(readFileSync(join(specDir, 'common_types.json'), 'utf8'));

// 1. Recursively extract all #/$defs/ references for a given schema node
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

// 2. Build dependency graph and compute topological order dynamically
const graph = new Map();
for (const [name, def] of Object.entries(commonJson.$defs)) {
  const deps = getDependencies(def);
  // Break circular dependency (DynamicValue references FunctionCall via z.lazy)
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

// Helper to recursively prepare JSON Schema nodes by resolving local/remote #/$defs references
function prepareRef(node, parentDefName) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(n => prepareRef(n, parentDefName));
  if (typeof node.$ref === 'string') {
    const idx = node.$ref.indexOf('#/$defs/');
    if (idx !== -1) {
      const targetName = node.$ref.substring(idx + 8);
      if (targetName === 'anyFunction') {
        return {enum: ['__REF__FunctionCallSchema__']};
      }
      if (parentDefName === 'DynamicValue' && targetName === 'FunctionCall') {
        return {enum: ['__REF__z.lazy(() => FunctionCallSchema)__']};
      }
      return {enum: ['__REF__' + targetName + 'Schema__']};
    }
  }
  const res = {};
  for (const [k, v] of Object.entries(node)) {
    res[k] = prepareRef(v, parentDefName);
  }
  return res;
}

let commonTs = HEADER + "import {z} from 'zod';\n\n";

// Include any defs not explicitly in topologicalOrder at the end
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
  code = code.replace(/z\.literal\("__REF__([^"]+)__"\)/g, '$1');
  code = code.replace(/z\.core\.\$ZodIssue/g, 'z.ZodIssue');
  code = code.replace(/ctx\.addIssue\(([^;]+)\);/g, 'ctx.addIssue($1 as any);');
  commonTs += code + '\n\n';
}

writeFileSync(join(destDir, 'common-types.ts'), commonTs);

// Helper to inspect a schema object and extract all referenced common-types schema names
const commonDefNames = new Set(Object.keys(commonJson.$defs));

function findCommonRefs(node, refs = new Set()) {
  if (!node || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    node.forEach(n => findCommonRefs(n, refs));
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
    findCommonRefs(v, refs);
  }
  return refs;
}

// 2. agent-to-renderer.ts
const a2rJson = JSON.parse(readFileSync(join(specDir, 'agent_to_renderer.json'), 'utf8'));

const a2rMessageNames = a2rJson.oneOf.map(ref => ref.$ref.replace('#/$defs/', ''));
const a2rImports = Array.from(
  new Set([...findCommonRefs(a2rJson), 'ComponentCommonSchema']),
).sort();

let a2rTs =
  HEADER +
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
  code = code.replace(/z\.literal\("__REF__([^"]+)__"\)/g, '$1');
  code = code.replace(/z\.core\.\$ZodIssue/g, 'z.ZodIssue');
  code = code.replace(/ctx\.addIssue\(([^;]+)\);/g, 'ctx.addIssue($1 as any);');
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
const r2aImports = Array.from(findCommonRefs(r2aJson)).sort();

let r2aTs =
  HEADER +
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
  code = code.replace(/z\.literal\("__REF__([^"]+)__"\)/g, '$1');
  code = code.replace(/z\.core\.\$ZodIssue/g, 'z.ZodIssue');
  code = code.replace(/ctx\.addIssue\(([^;]+)\);/g, 'ctx.addIssue($1 as any);');
  r2aTs += code + '\n\n';
}

r2aTs += `/** Union schema validating any outgoing v1.0 renderer-to-agent message envelope. */
export const RendererToAgentMessageSchema = z.union([
  ${r2aMessageNames.map(m => `${m}Schema`).join(',\n  ')},
]);
export type RendererToAgentMessage = z.infer<typeof RendererToAgentMessageSchema>;
`;

writeFileSync(join(destDir, 'renderer-to-agent.ts'), r2aTs);

// 4. index.ts
const indexTs =
  HEADER +
  `export * from './common-types.js';
export * from './agent-to-renderer.js';
export * from './renderer-to-agent.js';
`;

writeFileSync(join(destDir, 'index.ts'), indexTs);

console.log('Successfully generated Zod schemas.');
