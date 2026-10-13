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

import {A2uiCatalogError} from '../errors.js';
import {
  normalizeVersionString,
  V08Schemas,
  V09Schemas,
  V09_STANDARD_DEFS,
  V10Schemas,
  V10_STANDARD_DEFS,
} from '../internal/web-core.js';
import {envelopeSchemasFor} from './envelope-validation.js';

const DEFS_REF_PREFIX = '#/$defs/';
const PROPERTIES_REF_PREFIX = '#/properties/';

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

function collectRefs(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRefs(item, out);
    }
    return out;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        out.add(value);
      } else {
        collectRefs(value, out);
      }
    }
  }
  return out;
}

function reachableDefs(
  defs: Record<string, unknown>,
  roots: Iterable<string>,
  refPrefix = DEFS_REF_PREFIX,
): Record<string, unknown> {
  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (name in defs && !reachable.has(name)) {
      reachable.add(name);
      for (const ref of collectRefs(defs[name])) {
        if (ref.startsWith(refPrefix)) {
          queue.push(ref.slice(refPrefix.length));
        }
      }
    }
  }
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(defs)) {
    if (reachable.has(name)) {
      result[name] = value;
    }
  }
  return result;
}

/**
 * Returns the agent-to-renderer (server-to-client) JSON schema for a protocol version.
 */
export function loadAgentToRendererSchema(protocolVersion: string): Record<string, unknown> {
  const normalized = normalizeVersionString(protocolVersion);
  if (normalized === '0.8' || normalized.startsWith('0.8.')) {
    return structuredClone(V08Schemas.A2uiMessageSchemaRaw) as Record<string, unknown>;
  }
  if (normalized === '0.9') {
    return structuredClone(V09Schemas.A2uiMessageSchemaRaw) as Record<string, unknown>;
  }
  if (normalized.startsWith('0.9.')) {
    const schema = structuredClone(V09Schemas.A2uiMessageSchemaRaw) as Record<string, unknown>;
    const defs = schema.$defs as Record<string, Record<string, unknown>> | undefined;
    if (defs) {
      for (const defSchema of Object.values(defs)) {
        const props = defSchema.properties as Record<string, unknown> | undefined;
        if (props && 'version' in props) {
          props.version = {enum: ['v0.9', 'v0.9.1']};
        }
      }
    }
    return schema;
  }
  if (normalized === '1.0' || normalized.startsWith('1.0.')) {
    return structuredClone(V10Schemas.A2uiMessageSchemaRaw) as Record<string, unknown>;
  }
  throw new A2uiCatalogError(
    `No agent-to-renderer schema for protocol version '${protocolVersion}'.`,
  );
}

/**
 * Returns the common types JSON schema for a protocol version, or an empty object for v0.8.
 */
export function loadCommonTypesSchema(protocolVersion: string): Record<string, unknown> {
  const normalized = normalizeVersionString(protocolVersion);
  if (normalized === '0.8' || normalized.startsWith('0.8.')) {
    return {};
  }
  if (normalized === '0.9' || normalized.startsWith('0.9.')) {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://a2ui.org/specification/v0_9/common_types.json',
      title: 'A2UI Common Types',
      description: 'Common type definitions used across A2UI schemas.',
      $defs: structuredClone(V09_STANDARD_DEFS),
    };
  }
  if (normalized === '1.0' || normalized.startsWith('1.0.')) {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://a2ui.org/specification/v1_0/common_types.json',
      title: 'A2UI Common Types',
      description: 'Common type definitions used across A2UI schemas.',
      $defs: structuredClone(V10_STANDARD_DEFS),
    };
  }
  throw new A2uiCatalogError(`No common types schema for protocol version '${protocolVersion}'.`);
}

/**
 * Returns a copy of an agent-to-renderer schema that admits only the allowed messages.
 */
export function pruneMessagesSchema(
  a2rSchema: Record<string, unknown>,
  protocolVersion: string,
  allowedMessages: readonly string[],
): Record<string, unknown> {
  const pruned = structuredClone(a2rSchema);
  const normalized = normalizeVersionString(protocolVersion);
  if (normalized === '0.8' || normalized.startsWith('0.8.')) {
    const properties = pruned.properties;
    if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
      pruned.properties = reachableDefs(
        properties as Record<string, unknown>,
        allowedMessages,
        PROPERTIES_REF_PREFIX,
      );
    }
    return pruned;
  }

  const defs = pruned.$defs as Record<string, unknown> | undefined;
  const allowedDefs = new Set(allowedMessages);
  if (defs && typeof defs === 'object') {
    for (const [defName, defVal] of Object.entries(defs)) {
      if (typeof defVal === 'object' && defVal !== null) {
        const props = (defVal as Record<string, unknown>).properties;
        if (typeof props === 'object' && props !== null) {
          if (Object.keys(props).some(k => allowedDefs.has(k))) {
            allowedDefs.add(defName);
          }
        }
      }
    }
  }

  if (Array.isArray(pruned.oneOf)) {
    pruned.oneOf = pruned.oneOf.filter(item => {
      if (typeof item !== 'object' || item === null) return false;
      const ref = (item as Record<string, unknown>).$ref;
      return (
        typeof ref === 'string' &&
        ref.startsWith(DEFS_REF_PREFIX) &&
        allowedDefs.has(ref.slice(DEFS_REF_PREFIX.length))
      );
    });
  }
  if (defs && typeof defs === 'object') {
    pruned.$defs = reachableDefs(defs, allowedDefs, DEFS_REF_PREFIX);
  }
  return pruned;
}

/**
 * Returns a copy of the common types schema with only the definitions referenced by
 * `referencingSchemas` (directly or transitively).
 */
export function pruneCommonTypesSchema(
  commonTypesSchema: Record<string, unknown>,
  ...referencingSchemas: Record<string, unknown>[]
): Record<string, unknown> {
  if (Object.keys(commonTypesSchema).length === 0) {
    return {};
  }
  const pruned = structuredClone(commonTypesSchema);
  const defs = pruned.$defs;
  if (typeof defs !== 'object' || defs === null || Array.isArray(defs)) {
    return pruned;
  }

  const roots = new Set<string>();
  for (const schema of referencingSchemas) {
    for (const ref of collectRefs(schema)) {
      if (ref.includes('common_types.json#/$defs/') || ref.startsWith(DEFS_REF_PREFIX)) {
        const parts = ref.split(DEFS_REF_PREFIX);
        roots.add(parts[parts.length - 1]);
      }
    }
  }
  pruned.$defs = reachableDefs(defs as Record<string, unknown>, roots, DEFS_REF_PREFIX);
  return pruned;
}
