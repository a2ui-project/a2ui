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
import type {ComponentApi, FunctionApi} from './types.js';

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

const COMMON_PROPS: Record<string, z.ZodTypeAny> = {
  accessibility: AccessibilityAttributesSchema.optional(),
  weight: z
    .number()
    .describe(
      "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property.",
    )
    .optional(),
};

function resolveRef(ref: string): z.ZodTypeAny | undefined {
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

function convertPropertyToZod(propSchema: Record<string, any>): z.ZodTypeAny {
  if (!propSchema || typeof propSchema !== 'object') {
    return z.unknown();
  }

  if (propSchema.$ref && typeof propSchema.$ref === 'string') {
    const resolved = resolveRef(propSchema.$ref);
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
    const itemSchema = propSchema.items ? convertPropertyToZod(propSchema.items) : z.any();
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
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [propName, propSchema] of Object.entries(properties)) {
    if (omitEnvelopeFields && (propName === 'component' || propName === 'id')) {
      continue;
    }
    const zodField = convertPropertyToZod(propSchema as any);
    shape[propName] = requiredSet.has(propName) ? zodField : zodField.optional();
  }
  return shape;
}

function convertComponentJsonSchemaToZod(rawSchema: Record<string, any>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {
    ...COMMON_PROPS,
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

  const requiredSet = new Set<string>();
  for (const s of schemasToMerge) {
    if (Array.isArray(s.required)) {
      s.required.forEach((r: string) => requiredSet.add(r));
    }
  }

  for (const s of schemasToMerge) {
    const propShape = convertPropertiesToShape(s.properties || {}, requiredSet, true);
    Object.assign(shape, propShape);
  }

  return z.object(shape).strict();
}

function convertFunctionArgsJsonSchemaToZod(rawSchema: Record<string, any>): z.ZodObject<any> {
  const requiredSet = new Set<string>(Array.isArray(rawSchema.required) ? rawSchema.required : []);
  const shape = convertPropertiesToShape(rawSchema.properties || {}, requiredSet, false);
  return z.object(shape).strict();
}

function parseFunctionDefinitions(rawFunctions: any): FunctionApi[] {
  const result: FunctionApi[] = [];
  if (!rawFunctions) return result;

  if (Array.isArray(rawFunctions)) {
    for (const fn of rawFunctions) {
      if (fn && typeof fn.name === 'string') {
        const paramSchema =
          fn.parameters && typeof fn.parameters === 'object'
            ? convertFunctionArgsJsonSchemaToZod(fn.parameters)
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
          ? convertFunctionArgsJsonSchemaToZod(argsSchema)
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

export interface ParsedCatalogDefinition {
  catalogId: string;
  components: ComponentApi[];
  functions: FunctionApi[];
}

/**
 * Parses raw A2UI catalog JSON into typed ComponentApi and FunctionApi arrays with Zod schemas.
 *
 * @param catalogJson Raw JSON catalog definition.
 */
export function parseCatalogDefinition(catalogJson: Record<string, any>): ParsedCatalogDefinition {
  const catalogId = catalogJson.catalogId ?? catalogJson.$id ?? catalogJson.id;
  if (!catalogId || typeof catalogId !== 'string') {
    throw new Error("Catalog ID must be specified via catalog metadata ('catalogId' or '$id').");
  }

  // Filter permitted components via anyComponent.oneOf if declared
  const permittedNames = new Set<string>();
  const oneOf = catalogJson.$defs?.anyComponent?.oneOf;
  if (Array.isArray(oneOf)) {
    for (const item of oneOf) {
      if (typeof item?.$ref === 'string' && item.$ref.startsWith('#/components/')) {
        permittedNames.add(item.$ref.split('/').pop()!);
      }
    }
  }

  const components: ComponentApi[] = [];
  const componentsMap = catalogJson.components ?? {};
  for (const [name, rawCompSchema] of Object.entries(componentsMap)) {
    if (permittedNames.size === 0 || permittedNames.has(name)) {
      const zodSchema = convertComponentJsonSchemaToZod(rawCompSchema as Record<string, any>);
      components.push({
        name,
        schema: zodSchema,
      });
    }
  }

  const functions = parseFunctionDefinitions(catalogJson.functions);

  return {
    catalogId,
    components,
    functions,
  };
}
