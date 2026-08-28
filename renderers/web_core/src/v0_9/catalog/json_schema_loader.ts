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

import {z} from 'zod';
import {
  DynamicStringSchema,
  DynamicNumberSchema,
  DynamicBooleanSchema,
  DynamicStringListSchema,
  DynamicValueSchema,
  ComponentIdSchema,
  ChildListSchema,
  ActionSchema,
  CheckRuleSchema,
  CheckableSchema,
  AccessibilityAttributesSchema,
} from '../schema/common-types.js';
import {FunctionApi} from './types.js';

export interface CommonTypesRegistry {
  resolveRef(ref: string): z.ZodTypeAny | undefined;
  getCommonProps(): Record<string, z.ZodTypeAny>;
}

export const V0_9_COMMON_TYPES: CommonTypesRegistry = {
  resolveRef(ref: string): z.ZodTypeAny | undefined {
    const defName = ref.split(/#\/(?:\$defs|definitions)\//)[1];
    if (!defName) return undefined;

    switch (defName) {
      case 'DynamicString':
        return DynamicStringSchema;
      case 'DynamicNumber':
        return DynamicNumberSchema;
      case 'DynamicBoolean':
        return DynamicBooleanSchema;
      case 'DynamicStringList':
        return DynamicStringListSchema;
      case 'DynamicValue':
        return DynamicValueSchema;
      case 'ComponentId':
        return ComponentIdSchema;
      case 'ChildList':
        return ChildListSchema;
      case 'Action':
        return ActionSchema;
      case 'CheckRule':
        return CheckRuleSchema;
      case 'Checkable':
        return CheckableSchema;
      case 'AccessibilityAttributes':
        return AccessibilityAttributesSchema;
      default:
        return undefined;
    }
  },

  getCommonProps(): Record<string, z.ZodTypeAny> {
    return {
      'accessibility': AccessibilityAttributesSchema.optional(),
      'weight': z
        .number()
        .describe(
          "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property.",
        )
        .optional(),
    };
  },
};

export interface ExtractedCatalogMetadata {
  catalogId: string;
  specVersion: string;
}

/**
 * Extracts catalog ID and protocol specification version.
 * Defaults protocol version to 'v0.9' per specification (specification/v1_0/json/catalog_definition.json#L14)
 * if not explicitly provided or discoverable in metadata.
 */
export function extractCatalogMetadata(data: Record<string, any>): ExtractedCatalogMetadata {
  const catalogId = data.catalogId ?? data.$id ?? data.id;
  if (!catalogId || typeof catalogId !== 'string') {
    throw new Error("Catalog ID must be specified via catalog metadata ('catalogId' or '$id').");
  }

  // 1. Explicit top-level version in JSON
  const rawVer = data.protocolVersion ?? data.version ?? data.specVersion ?? data.target_version;
  if (typeof rawVer === 'string' && rawVer.trim() !== '') {
    const trimmed = rawVer.trim();
    return {catalogId, specVersion: trimmed.startsWith('v') ? trimmed : `v${trimmed}`};
  }

  // 2. Extracted from URI pattern in catalogId or $id (e.g. /v0_9/, /v0_9_1/, /v1_0/)
  const uriMatch = catalogId.match(/\/v?([0-9]+(?:[_.][0-9]+)*)\//);
  if (uriMatch && uriMatch[1]) {
    const rawMatch = uriMatch[1].replace(/_/g, '.');
    return {catalogId, specVersion: rawMatch.startsWith('v') ? rawMatch : `v${rawMatch}`};
  }

  // 3. Extracted from $schema or $defs reference URI
  const schemaUri = typeof data.$schema === 'string' ? data.$schema : '';
  const schemaMatch = schemaUri.match(/\/v?([0-9]+(?:[_.][0-9]+)*)\//);
  if (schemaMatch && schemaMatch[1]) {
    const rawMatch = schemaMatch[1].replace(/_/g, '.');
    return {catalogId, specVersion: rawMatch.startsWith('v') ? rawMatch : `v${rawMatch}`};
  }

  // 4. Default to v0.9 per specification (specification/v1_0/json/catalog_definition.json#L14)
  return {catalogId, specVersion: 'v0.9'};
}

/**
 * Safely converts an array of enum values to a Zod schema.
 * Handles strings, numbers, booleans, and mixed types without crashing z.enum.
 */
export function convertEnumToZod(values: unknown[]): z.ZodTypeAny {
  if (values.length === 0) {
    return z.unknown();
  }
  if (values.every(v => typeof v === 'string')) {
    return z.enum(values as [string, ...string[]]);
  }
  if (values.length === 1) {
    return z.literal(values[0] as string | number | boolean);
  }
  return z.union(
    values.map(v => z.literal(v as string | number | boolean)) as unknown as [
      z.ZodTypeAny,
      z.ZodTypeAny,
      ...z.ZodTypeAny[],
    ],
  );
}

/**
 * Converts a JSON schema property into a Zod schema, resolving canonical common types.
 */
export function convertPropertyToZod(
  propSchema: Record<string, any>,
  registry: CommonTypesRegistry,
): z.ZodTypeAny {
  if (!propSchema || typeof propSchema !== 'object') {
    return z.unknown();
  }

  if (propSchema.$ref && typeof propSchema.$ref === 'string') {
    const resolved = registry.resolveRef(propSchema.$ref);
    if (resolved) {
      const defName = propSchema.$ref.split(/#\/(?:\$defs|definitions)\//)[1];
      const desc = propSchema.description
        ? `REF:common_types.json#/$defs/${defName}|${propSchema.description}`
        : resolved.description;
      return desc ? resolved.describe(desc) : resolved;
    }
  }

  // oneOf / anyOf inspection (e.g. Icon.name which has enum + DataBinding)
  if (Array.isArray(propSchema.oneOf) || Array.isArray(propSchema.anyOf)) {
    const branches: Record<string, any>[] = (propSchema.oneOf || propSchema.anyOf) as any[];
    const enumBranch = branches.find(b => Array.isArray(b.enum));
    const hasBinding = branches.some(
      b => typeof b.$ref === 'string' && b.$ref.includes('DataBinding'),
    );
    if (enumBranch) {
      let enumZod = convertEnumToZod(enumBranch.enum);
      if (propSchema.default !== undefined) {
        enumZod = enumZod.default(propSchema.default);
      }
      const desc =
        propSchema.description ||
        (hasBinding ? 'REF:common_types.json#/$defs/DynamicString' : undefined);
      if (desc) {
        enumZod = enumZod.describe(desc);
      }
      return enumZod;
    }
  }

  // Enums
  if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    let enumZod = convertEnumToZod(propSchema.enum);
    if (propSchema.default !== undefined) {
      enumZod = enumZod.default(propSchema.default);
    }
    if (propSchema.description) {
      enumZod = enumZod.describe(propSchema.description);
    }
    return enumZod;
  }

  // Arrays
  if (propSchema.type === 'array') {
    const itemSchema = propSchema.items
      ? convertPropertyToZod(propSchema.items, registry)
      : z.any();
    let arr = z.array(itemSchema);
    if (propSchema.description) arr = arr.describe(propSchema.description) as any;
    return arr;
  }

  // Primitives
  switch (propSchema.type) {
    case 'string': {
      let s = z.string();
      if (propSchema.default !== undefined) s = s.default(propSchema.default) as any;
      if (propSchema.description) s = s.describe(propSchema.description) as any;
      return s;
    }
    case 'integer': {
      let n: z.ZodTypeAny = z.number().int();
      if (propSchema.default !== undefined) n = n.default(propSchema.default) as any;
      if (propSchema.description) n = n.describe(propSchema.description) as any;
      return n;
    }
    case 'number': {
      let n: z.ZodTypeAny = z.number();
      if (propSchema.default !== undefined) n = n.default(propSchema.default) as any;
      if (propSchema.description) n = n.describe(propSchema.description) as any;
      return n;
    }
    case 'boolean': {
      let b = z.boolean();
      if (propSchema.default !== undefined) b = b.default(propSchema.default) as any;
      if (propSchema.description) b = b.describe(propSchema.description) as any;
      return b;
    }
    case 'object': {
      let obj = z.record(z.any());
      if (propSchema.description) obj = obj.describe(propSchema.description) as any;
      return obj;
    }
    default: {
      let anyZ = z.any();
      if (propSchema.description) anyZ = anyZ.describe(propSchema.description);
      return anyZ;
    }
  }
}

/**
 * Decomposes an allOf component JSON schema into a concrete ComponentApi ZodObject.
 */
export function convertComponentJsonSchemaToZod(
  rawSchema: Record<string, any>,
  registry: CommonTypesRegistry,
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {
    ...registry.getCommonProps(),
  };

  const schemasToMerge: Record<string, any>[] = [];
  if (Array.isArray(rawSchema.allOf)) {
    for (const sub of rawSchema.allOf) {
      if (sub && typeof sub === 'object' && sub.properties) {
        schemasToMerge.push(sub);
      }
    }
  }
  if (rawSchema.properties) {
    schemasToMerge.push(rawSchema);
  }

  // First pass: collect all required fields across all schemas
  const requiredSet = new Set<string>();
  for (const s of schemasToMerge) {
    if (Array.isArray(s.required)) {
      s.required.forEach((r: string) => requiredSet.add(r));
    }
  }

  // Second pass: map property schemas to Zod
  for (const s of schemasToMerge) {
    for (const [propName, propSchema] of Object.entries(s.properties || {})) {
      // Omit envelope-level properties handled by protocol runtime
      if (propName === 'component' || propName === 'id') {
        continue;
      }

      const zodField = convertPropertyToZod(propSchema as any, registry);
      const isRequired = requiredSet.has(propName);
      shape[propName] = isRequired ? zodField : zodField.optional();
    }
  }

  return z.object(shape).strict();
}

/**
 * Converts function args JSON schema into a ZodObject without component-level common properties.
 */
export function convertFunctionArgsJsonSchemaToZod(
  rawSchema: Record<string, any>,
  registry: CommonTypesRegistry,
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const requiredSet = new Set<string>(Array.isArray(rawSchema.required) ? rawSchema.required : []);

  for (const [propName, propSchema] of Object.entries(rawSchema.properties || {})) {
    const zodField = convertPropertyToZod(propSchema as any, registry);
    const isRequired = requiredSet.has(propName);
    shape[propName] = isRequired ? zodField : zodField.optional();
  }

  return z.object(shape).strict();
}

/**
 * Parses function definitions from both object map format and client capabilities array format.
 */
export function parseFunctionDefinitions(
  rawFunctions: any,
  registry: CommonTypesRegistry,
): FunctionApi[] {
  const result: FunctionApi[] = [];
  if (!rawFunctions) return result;

  if (Array.isArray(rawFunctions)) {
    for (const fn of rawFunctions) {
      if (fn && typeof fn.name === 'string') {
        const paramSchema =
          fn.parameters && typeof fn.parameters === 'object'
            ? convertFunctionArgsJsonSchemaToZod(fn.parameters, registry)
            : z.record(z.any());
        result.push({
          name: fn.name,
          description: fn.description,
          returnType: fn.returnType ?? 'any',
          schema: paramSchema,
        });
      }
    }
    return result;
  }

  if (typeof rawFunctions === 'object') {
    for (const [name, defn] of Object.entries(rawFunctions)) {
      const d = defn as any;
      const argsSchema = d.properties?.args ?? d.args ?? d.parameters;
      const paramSchema =
        argsSchema && typeof argsSchema === 'object'
          ? convertFunctionArgsJsonSchemaToZod(argsSchema, registry)
          : z.record(z.any());
      result.push({
        name,
        description: d.description,
        returnType: d.returnType ?? d.properties?.returnType?.const ?? 'any',
        schema: paramSchema,
      });
    }
  }

  return result;
}
