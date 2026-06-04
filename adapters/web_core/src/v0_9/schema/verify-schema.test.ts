/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {readFileSync} from 'fs';
import {resolve, join, dirname} from 'path';
import {fileURLToPath} from 'url';
import {
  A2uiMessageSchema,
  CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema,
} from './server-to-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// `__dirname` will be `dist/src/v0_9/schema` when run via `node --test dist/**/*.test.js`
const SPEC_DIR_V0_9 = resolve(__dirname, '../../../../../../specification/v0_9/json');

// Parse both so we can do structural comparison rather than formatting
// Compare definitions specifically, ignoring descriptions
function compareDefinitions(zodDefs: any, jsonDefs: any): Record<string, any> {
  const diff: Record<string, any> = {};
  const keys = new Set([...Object.keys(zodDefs || {}), ...Object.keys(jsonDefs || {})]);

  for (const key of keys) {
    if (key === 'A2uiMessage') continue; // Zod wrapper artifact

    if (!zodDefs[key]) diff[key] = {error: 'Missing in Zod schema'};
    else if (!jsonDefs[key]) diff[key] = {error: 'Missing in JSON schema'};
    else {
      const defDiff = getObjectDiff(zodDefs[key], jsonDefs[key]);
      if (Object.keys(defDiff).length > 0) {
        diff[key] = defDiff;
      }
    }
  }
  return diff;
}

function getObjectDiff(obj1: any, obj2: any, path = ''): Record<string, any> {
  const diff: Record<string, any> = {};

  // Ignore descriptions in strict structural comparison
  const ignoreKeys = new Set(['description', 'title', '$id', '$schema']);

  const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

  for (const key of keys) {
    if (ignoreKeys.has(key)) continue;

    const currentPath = path ? `${path}.${key}` : key;
    const val1 = obj1 ? obj1[key] : undefined;
    const val2 = obj2 ? obj2[key] : undefined;

    // Zod emits `type: "string"` for consts, whereas JSON Schema infers it.
    if (path.endsWith('version') && key === 'type' && val1 === 'string' && val2 === undefined) {
      continue;
    }

    // Zod doesn't emit additionalProperties: true by default, but it's the default
    if (
      currentPath.endsWith('updateDataModel.properties.value.additionalProperties') &&
      val1 === undefined &&
      val2 === true
    ) {
      continue;
    }

    // Zod resolves the AnyComponentSchema instead of preserving the $ref because we imported it.
    // The JSON spec uses a `$ref` to `catalog.json`
    if (currentPath.includes('components.items')) {
      continue;
    }

    // Zod defines theme as any (no validation), while JSON spec references catalog.json theme schema
    if (
      currentPath.includes('theme.$ref') &&
      val1 === undefined &&
      val2 === 'catalog.json#/$defs/theme'
    ) {
      continue;
    }

    if (typeof val1 === 'object' && val1 !== null && typeof val2 === 'object' && val2 !== null) {
      if (Array.isArray(val1) && Array.isArray(val2)) {
        // Sort arrays to ignore order differences (like `required`)
        const sortedVal1 = [...val1].sort();
        const sortedVal2 = [...val2].sort();
        if (JSON.stringify(sortedVal1) !== JSON.stringify(sortedVal2)) {
          diff[currentPath] = {zod: val1, json: val2};
        }
      } else {
        const nestedDiff = getObjectDiff(val1, val2, currentPath);
        if (Object.keys(nestedDiff).length > 0) {
          Object.assign(diff, nestedDiff);
        }
      }
    } else if (val1 !== val2) {
      diff[currentPath] = {zod: val1, json: val2};
    }
  }

  return diff;
}

function verifySchema(
  version: string,
  zodSchemaSpec: any,
  jsonSpecPath: string,
  definitionsMap?: Record<string, any>,
) {
  console.log(`\nVerifying Zod schema for ${version}...`);
  // Generate JSON Schema from Zod
  const jsonSchemaString = JSON.stringify(
    zodToJsonSchema(zodSchemaSpec, {
      target: 'jsonSchema2019-09', // Better matches draft 2020-12
      definitions: definitionsMap || {},
      name: 'A2uiMessage',
    }),
    null,
    2,
  );

  // Load the official schema
  const officialSchemaString = readFileSync(jsonSpecPath, 'utf-8');

  // Extract the definitions
  const generatedSchema = JSON.parse(jsonSchemaString);
  const officialSchema = JSON.parse(officialSchemaString);

  if (definitionsMap) {
    const zodDefs = generatedSchema.$defs || generatedSchema.definitions || {};
    const jsonDefs = officialSchema.$defs || officialSchema.definitions || {};

    const diffs = compareDefinitions(zodDefs, jsonDefs);

    if (Object.keys(diffs).length > 0) {
      assert.deepStrictEqual(
        diffs,
        {},
        `Zod schema definitions do not structurally match the ${version} JSON spec.`,
      );
    }
  }

  const rootZodSchema =
    (generatedSchema.definitions || generatedSchema.$defs || {})['A2uiMessage'] || {};

  if (officialSchema.oneOf || officialSchema.anyOf) {
    const zodOneOf = rootZodSchema.anyOf || rootZodSchema.oneOf || [];
    const normalizedGeneratedOneOf = zodOneOf.map((schema: any) => {
      if (schema.$ref && schema.$ref.startsWith('#/definitions/')) {
        return {$ref: schema.$ref.replace('#/definitions/', '#/$defs/')};
      }
      return schema;
    });

    const topLevelDiff = getObjectDiff(
      normalizedGeneratedOneOf,
      officialSchema.oneOf || officialSchema.anyOf,
    );
    if (Object.keys(topLevelDiff).length > 0) {
      assert.deepStrictEqual(
        topLevelDiff,
        {},
        `Zod schema top-level oneOf does not match the ${version} JSON spec.`,
      );
    }
  } else if (officialSchema.properties) {
    const topLevelDiff = getObjectDiff(rootZodSchema.properties, officialSchema.properties);
    if (Object.keys(topLevelDiff).length > 0) {
      assert.deepStrictEqual(
        topLevelDiff,
        {},
        `Zod schema top-level properties do not match the ${version} JSON spec.`,
      );
    }
  }

  console.log(`Zod schema structurally matches the ${version} JSON spec!`);
}

describe('A2UI Schema Verification v0.9', () => {
  it('verifies v0.9 schema', () => {
    verifySchema('v0.9', A2uiMessageSchema, join(SPEC_DIR_V0_9, 'server_to_client.json'), {
      CreateSurfaceMessage: CreateSurfaceMessageSchema,
      UpdateComponentsMessage: UpdateComponentsMessageSchema,
      UpdateDataModelMessage: UpdateDataModelMessageSchema,
      DeleteSurfaceMessage: DeleteSurfaceMessageSchema,
    });
  });

  it('validates A2uiMessage wrapper', () => {
    const msg = {
      version: 'v0.9',
      deleteSurface: {surfaceId: 'surface-1'},
    };
    assert.deepStrictEqual(A2uiMessageSchema.parse(msg), msg);
  });
});
