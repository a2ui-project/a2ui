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
import {Catalog, type ComponentApi, type FunctionApi} from './types.js';

const COMMON_TYPE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  DynamicString: DynamicStringSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicBoolean: DynamicBooleanSchema,
  DynamicStringList: DynamicStringListSchema,
  DynamicValue: DynamicValueSchema,
  ComponentId: ComponentIdSchema,
  ChildList: ChildListSchema,
  Action: ActionSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
};

/**
 * Resolves a JSON Pointer within a root JSON document.
 * Follows RFC 6901 pointer unescaping (~1 -> /, ~0 -> ~).
 */
function resolveJsonPointer(
  rootDoc: Record<string, any>,
  pointer: string,
): Record<string, any> | undefined {
  if (!pointer.startsWith('#/')) return undefined;
  const segments = pointer
    .slice(2)
    .split('/')
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));

  let curr: any = rootDoc;
  for (const seg of segments) {
    if (curr && typeof curr === 'object' && seg in curr) {
      curr = curr[seg];
    } else {
      return undefined;
    }
  }
  return typeof curr === 'object' && curr !== null ? curr : undefined;
}

function resolveProtocolRef(ref: string): z.ZodTypeAny | undefined {
  const defName = ref.split(/#\/(?:\$defs|definitions)\//)[1];
  return defName ? COMMON_TYPE_SCHEMAS[defName] : undefined;
}

function convertEnumToZod(values: unknown[]): z.ZodTypeAny {
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

function convertPropertyToZod(
  propSchema: Record<string, any>,
  rootDoc?: Record<string, any>,
  visitedPointers = new Set<string>(),
): z.ZodTypeAny {
  if (!propSchema || typeof propSchema !== 'object') {
    return z.unknown();
  }

  if (propSchema.$ref && typeof propSchema.$ref === 'string') {
    const ref = propSchema.$ref;
    // Protocol canonical types
    const resolvedProtocol = resolveProtocolRef(ref);
    if (resolvedProtocol) {
      const defName = ref.split(/#\/(?:\$defs|definitions)\//)[1];
      const desc = propSchema.description
        ? `REF:common_types.json#/$defs/${defName}|${propSchema.description}`
        : resolvedProtocol.description;
      return desc ? resolvedProtocol.describe(desc) : resolvedProtocol;
    }

    // Document-local $defs reference
    if (rootDoc && ref.startsWith('#/') && !visitedPointers.has(ref)) {
      visitedPointers.add(ref);
      const localTarget = resolveJsonPointer(rootDoc, ref);
      if (localTarget) {
        let zodType = convertPropertyToZod(localTarget, rootDoc, visitedPointers);
        if (propSchema.description) {
          zodType = zodType.describe(propSchema.description);
        }
        return zodType;
      }
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
      ? convertPropertyToZod(propSchema.items, rootDoc, visitedPointers)
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

function convertPropertiesToShape(
  properties: Record<string, any>,
  requiredSet: Set<string>,
  omitEnvelopeFields = false,
  rootDoc?: Record<string, any>,
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [propName, propSchema] of Object.entries(properties)) {
    if (omitEnvelopeFields && (propName === 'component' || propName === 'id')) {
      continue;
    }
    const zodField = convertPropertyToZod(propSchema as any, rootDoc);
    shape[propName] = requiredSet.has(propName) ? zodField : zodField.optional();
  }
  return shape;
}

/**
 * Collects all property definitions and constraints from a component schema,
 * resolving local document $defs and canonical protocol ComponentCommon references.
 */
function collectComponentSubSchemas(
  schema: Record<string, any>,
  rootDoc: Record<string, any>,
  visitedPointers = new Set<string>(),
): Record<string, any>[] {
  const result: Record<string, any>[] = [];
  if (!schema || typeof schema !== 'object') return result;

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (!sub || typeof sub !== 'object') continue;

      if (typeof sub.$ref === 'string') {
        const ref = sub.$ref;
        if (ref.includes('common_types.json') && ref.includes('ComponentCommon')) {
          // Protocol common properties: accessibility attributes
          result.push({
            properties: {
              accessibility: AccessibilityAttributesSchema.optional(),
            },
          });
        } else if (ref.startsWith('#/')) {
          if (!visitedPointers.has(ref)) {
            visitedPointers.add(ref);
            const target = resolveJsonPointer(rootDoc, ref);
            if (target) {
              result.push(...collectComponentSubSchemas(target, rootDoc, visitedPointers));
            }
          }
        }
      } else {
        result.push(...collectComponentSubSchemas(sub, rootDoc, visitedPointers));
      }
    }
  }

  if (schema.properties) {
    result.push(schema);
  }

  return result;
}

function convertComponentJsonSchemaToZod(
  rawSchema: Record<string, any>,
  rootDoc: Record<string, any>,
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const schemasToMerge = collectComponentSubSchemas(rawSchema, rootDoc);

  const requiredSet = new Set<string>();
  for (const s of schemasToMerge) {
    if (Array.isArray(s.required)) {
      s.required.forEach((r: string) => requiredSet.add(r));
    }
  }

  for (const s of schemasToMerge) {
    const propShape = convertPropertiesToShape(s.properties || {}, requiredSet, true, rootDoc);
    Object.assign(shape, propShape);
  }

  return z.object(shape).strict();
}

function convertFunctionArgsJsonSchemaToZod(
  rawSchema: Record<string, any>,
  rootDoc?: Record<string, any>,
): z.ZodObject<any> {
  const requiredSet = new Set<string>(Array.isArray(rawSchema.required) ? rawSchema.required : []);
  const shape = convertPropertiesToShape(rawSchema.properties || {}, requiredSet, false, rootDoc);
  return z.object(shape).strict();
}

function parseFunctionDefinitions(rawFunctions: any, rootDoc?: Record<string, any>): FunctionApi[] {
  const result: FunctionApi[] = [];
  if (!rawFunctions) return result;

  if (Array.isArray(rawFunctions)) {
    for (const fn of rawFunctions) {
      if (fn && typeof fn.name === 'string') {
        const paramSchema =
          fn.parameters && typeof fn.parameters === 'object'
            ? convertFunctionArgsJsonSchemaToZod(fn.parameters, rootDoc)
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
          ? convertFunctionArgsJsonSchemaToZod(argsSchema, rootDoc)
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

/**
 * Loads raw A2UI catalog schema directly into a typed Catalog instance.
 *
 * @param catalogSchema Raw catalog schema or capabilities definition object.
 */
export function loadCatalogFromSchema(
  catalogSchema: Record<string, any>,
): Catalog<ComponentApi, FunctionApi> {
  const catalogId = catalogSchema.catalogId ?? catalogSchema.$id ?? catalogSchema.id;
  if (!catalogId || typeof catalogId !== 'string') {
    throw new Error("Catalog ID must be specified via catalog metadata ('catalogId' or '$id').");
  }

  // Filter permitted components via anyComponent.oneOf if declared
  const permittedNames = new Set<string>();
  const oneOf = catalogSchema.$defs?.anyComponent?.oneOf;
  if (Array.isArray(oneOf)) {
    for (const item of oneOf) {
      if (typeof item?.$ref === 'string' && item.$ref.startsWith('#/components/')) {
        permittedNames.add(item.$ref.split('/').pop()!);
      }
    }
  }

  const components: ComponentApi[] = [];
  const componentsMap = catalogSchema.components ?? {};
  for (const [name, rawCompSchema] of Object.entries(componentsMap)) {
    if (permittedNames.size === 0 || permittedNames.has(name)) {
      const zodSchema = convertComponentJsonSchemaToZod(
        rawCompSchema as Record<string, any>,
        catalogSchema,
      );
      components.push({
        name,
        schema: zodSchema,
      });
    }
  }

  const functions = parseFunctionDefinitions(catalogSchema.functions, catalogSchema);

  return new Catalog(catalogId, components, functions);
}
