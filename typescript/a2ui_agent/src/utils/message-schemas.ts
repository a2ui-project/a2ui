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

import {zodToJsonSchema} from 'zod-to-json-schema';

import {normalizeVersionString} from '../internal/web-core.js';
import {envelopeSchemasFor} from './envelope-validation.js';

const jsonSchemasByVersion = new Map<string, Record<string, Record<string, unknown>>>();

/**
 * Removes the markers web_core's generated Zod models leave in descriptions.
 *
 * The generator records a protocol `$ref` as a description of the form
 * `REF:<target>|<text>`. A prompt only needs the text, so the marker is dropped, along
 * with the `$schema` keyword `zod-to-json-schema` adds.
 */
function stripGeneratorMarkers(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(stripGeneratorMarkers);
    return;
  }
  if (typeof node !== 'object' || node === null) {
    return;
  }
  const obj = node as Record<string, unknown>;
  delete obj.$schema;
  if (typeof obj.description === 'string' && obj.description.startsWith('REF:')) {
    const pipe = obj.description.indexOf('|');
    if (pipe === -1) {
      delete obj.description;
    } else {
      obj.description = obj.description.slice(pipe + 1);
    }
  }
  Object.values(obj).forEach(stripGeneratorMarkers);
}

/**
 * Returns the JSON Schema of each agent-to-renderer message in a protocol version, keyed
 * by envelope name, for embedding in a prompt.
 *
 * The schemas are derived from web_core's Zod message models rather than read from
 * bundled schema files. They are computed once per version and returned in the order
 * the protocol lists the messages, so prompts built from them are deterministic.
 *
 * @param protocolVersion Protocol version in any spelling a catalog uses.
 * @throws {A2uiCatalogError} If the SDK has no message schemas for the version.
 */
export function messageJsonSchemas(
  protocolVersion: string,
): Record<string, Record<string, unknown>> {
  const key = normalizeVersionString(protocolVersion);
  let schemas = jsonSchemasByVersion.get(key);
  if (!schemas) {
    schemas = {};
    for (const [name, zodSchema] of Object.entries(envelopeSchemasFor(protocolVersion))) {
      const jsonSchema = zodToJsonSchema(zodSchema, {$refStrategy: 'none'}) as Record<
        string,
        unknown
      >;
      stripGeneratorMarkers(jsonSchema);
      schemas[name] = jsonSchema;
    }
    jsonSchemasByVersion.set(key, schemas);
  }
  return schemas;
}
