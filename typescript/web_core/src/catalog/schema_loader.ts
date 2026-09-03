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
} from '../types/common-types.js';
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
  rootDoc: Record<string, unknown>,
  pointer: string,
): Record<string, unknown> | undefined {
  if (!pointer.startsWith('#/')) return undefined;
  const segments = pointer
    .slice(2)
    .split('/')
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));

  let curr: unknown = rootDoc;
  for (const seg of segments) {
    if (curr && typeof curr === 'object' && seg in curr) {
      curr = (curr as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return typeof curr === 'object' && curr !== null ? (curr as Record<string, unknown>) : undefined;
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
  propSchema: Record<string, unknown>,
  rootDoc?: Record<string, unknown>,
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
      const desc =
        typeof propSchema.description === 'string'
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
        if (typeof propSchema.description === 'string') {
          zodType = zodType.describe(propSchema.description);
        }
        return zodType;
      }
    }
  }

  // oneOf / anyOf inspection (e.g. Icon.name which has enum + DataBinding, or arbitrary type unions)
  if (Array.isArray(propSchema.oneOf) || Array.isArray(propSchema.anyOf)) {
    const rawBranches = (propSchema.oneOf || propSchema.anyOf) as unknown[];
    const branches = rawBranches.filter(
      (b): b is Record<string, unknown> => typeof b === 'object' && b !== null,
    );
    const enumBranch = branches.find(b => Array.isArray(b.enum));
    const hasBinding = branches.some(
      b => typeof b.$ref === 'string' && b.$ref.includes('DataBinding'),
    );
    if (enumBranch && Array.isArray(enumBranch.enum)) {
      let enumZod = convertEnumToZod(enumBranch.enum);
      if (propSchema.default !== undefined) {
        enumZod = enumZod.default(propSchema.default);
      }
      const desc =
        (typeof propSchema.description === 'string' ? propSchema.description : undefined) ||
        (hasBinding ? 'REF:common_types.json#/$defs/DynamicString' : undefined);
      if (desc) {
        enumZod = enumZod.describe(desc);
      }
      return enumZod;
    }

    if (branches.length > 0) {
      const zodBranches = branches.map(b => convertPropertyToZod(b, rootDoc, visitedPointers));
      let unionZod: z.ZodTypeAny;
      if (zodBranches.length === 1) {
        unionZod = zodBranches[0];
      } else {
        unionZod = z.union([zodBranches[0], zodBranches[1], ...zodBranches.slice(2)]);
      }
      if (propSchema.default !== undefined) {
        unionZod = unionZod.default(propSchema.default);
      }
      if (typeof propSchema.description === 'string') {
        unionZod = unionZod.describe(propSchema.description);
      }
      return unionZod;
    }
  }

  // Enums
  if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    let enumZod = convertEnumToZod(propSchema.enum);
    if (propSchema.default !== undefined) {
      enumZod = enumZod.default(propSchema.default);
    }
    if (typeof propSchema.description === 'string') {
      enumZod = enumZod.describe(propSchema.description);
    }
    return enumZod;
  }

  // Arrays
  if (propSchema.type === 'array') {
    const itemSchema =
      propSchema.items && typeof propSchema.items === 'object'
        ? convertPropertyToZod(
            propSchema.items as Record<string, unknown>,
            rootDoc,
            visitedPointers,
          )
        : z.unknown();
    let arr: z.ZodTypeAny = z.array(itemSchema);
    if (typeof propSchema.description === 'string') {
      arr = arr.describe(propSchema.description);
    }
    return arr;
  }

  // Primitives
  switch (propSchema.type) {
    case 'string': {
      let s: z.ZodTypeAny = z.string();
      if (propSchema.default !== undefined) s = s.default(propSchema.default);
      if (typeof propSchema.description === 'string') s = s.describe(propSchema.description);
      return s;
    }
    case 'integer': {
      let n: z.ZodTypeAny = z.number().int();
      if (propSchema.default !== undefined) n = n.default(propSchema.default);
      if (typeof propSchema.description === 'string') n = n.describe(propSchema.description);
      return n;
    }
    case 'number': {
      let n: z.ZodTypeAny = z.number();
      if (propSchema.default !== undefined) n = n.default(propSchema.default);
      if (typeof propSchema.description === 'string') n = n.describe(propSchema.description);
      return n;
    }
    case 'boolean': {
      let b: z.ZodTypeAny = z.boolean();
      if (propSchema.default !== undefined) b = b.default(propSchema.default);
      if (typeof propSchema.description === 'string') b = b.describe(propSchema.description);
      return b;
    }
    case 'object': {
      let obj: z.ZodTypeAny = z.record(z.unknown());
      if (typeof propSchema.description === 'string') obj = obj.describe(propSchema.description);
      return obj;
    }
    default: {
      let unk: z.ZodTypeAny = z.unknown();
      if (typeof propSchema.description === 'string') unk = unk.describe(propSchema.description);
      return unk;
    }
  }
}

function convertPropertiesToShape(
  properties: Record<string, unknown>,
  requiredSet: Set<string>,
  omitEnvelopeFields = false,
  rootDoc?: Record<string, unknown>,
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [propName, propSchema] of Object.entries(properties)) {
    if (omitEnvelopeFields && (propName === 'component' || propName === 'id')) {
      continue;
    }
    const zodField = convertPropertyToZod(
      typeof propSchema === 'object' && propSchema !== null
        ? (propSchema as Record<string, unknown>)
        : {},
      rootDoc,
    );
    shape[propName] = requiredSet.has(propName) ? zodField : zodField.optional();
  }
  return shape;
}

/**
 * Collects all property definitions and constraints from a component schema,
 * resolving local document $defs and canonical protocol ComponentCommon references.
 */
function collectComponentSubSchemas(
  schema: Record<string, unknown>,
  rootDoc: Record<string, unknown>,
  visitedPointers = new Set<string>(),
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
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
  rawSchema: Record<string, unknown>,
  rootDoc: Record<string, unknown>,
  omitEnvelopeFields = true,
): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const schemasToMerge = collectComponentSubSchemas(rawSchema, rootDoc);

  const requiredSet = new Set<string>();
  for (const s of schemasToMerge) {
    if (Array.isArray(s.required)) {
      s.required.forEach((r: unknown) => {
        if (typeof r === 'string') requiredSet.add(r);
      });
    }
  }

  for (const s of schemasToMerge) {
    const propShape = convertPropertiesToShape(
      (s.properties as Record<string, unknown>) || {},
      requiredSet,
      omitEnvelopeFields,
      rootDoc,
    );
    Object.assign(shape, propShape);
  }

  const obj = z.object(shape);
  const allowExtra =
    rawSchema.unevaluatedProperties === true ||
    (typeof rawSchema.unevaluatedProperties === 'object' &&
      rawSchema.unevaluatedProperties !== null) ||
    rawSchema.additionalProperties === true ||
    (typeof rawSchema.additionalProperties === 'object' && rawSchema.additionalProperties !== null);
  return allowExtra ? obj.passthrough() : obj.strict();
}

function convertFunctionArgsJsonSchemaToZod(
  rawSchema: Record<string, unknown>,
  rootDoc?: Record<string, unknown>,
): z.ZodObject<z.ZodRawShape> {
  const requiredSet = new Set<string>(
    Array.isArray(rawSchema.required)
      ? rawSchema.required.filter((r): r is string => typeof r === 'string')
      : [],
  );
  const shape = convertPropertiesToShape(
    (rawSchema.properties as Record<string, unknown>) || {},
    requiredSet,
    false,
    rootDoc,
  );
  const obj = z.object(shape);
  const allowExtra =
    rawSchema.unevaluatedProperties === true ||
    (typeof rawSchema.unevaluatedProperties === 'object' &&
      rawSchema.unevaluatedProperties !== null) ||
    rawSchema.additionalProperties === true ||
    (typeof rawSchema.additionalProperties === 'object' && rawSchema.additionalProperties !== null);
  return allowExtra ? obj.passthrough() : obj.strict();
}

function parseFunctionDefinitions(
  rawFunctions: unknown,
  rootDoc?: Record<string, unknown>,
  permittedNames?: Set<string>,
): FunctionApi[] {
  const result: FunctionApi[] = [];
  if (!rawFunctions) return result;

  if (Array.isArray(rawFunctions)) {
    for (const fn of rawFunctions) {
      if (fn && typeof fn === 'object' && typeof fn.name === 'string') {
        if (permittedNames && !permittedNames.has(fn.name)) {
          continue;
        }
        const paramSchema =
          fn.parameters && typeof fn.parameters === 'object'
            ? convertFunctionArgsJsonSchemaToZod(fn.parameters as Record<string, unknown>, rootDoc)
            : z.record(z.unknown());
        result.push({
          name: fn.name,
          description: typeof fn.description === 'string' ? fn.description : undefined,
          returnType: (typeof fn.returnType === 'string' ? fn.returnType : 'any') as any,
          allowedCallers: fn.allowedCallers,
          requiresUserActivation: fn.requiresUserActivation,
          schema: paramSchema,
        });
      }
    }
    return result;
  }

  if (typeof rawFunctions === 'object' && rawFunctions !== null) {
    for (const [name, defn] of Object.entries(rawFunctions)) {
      if (permittedNames && !permittedNames.has(name)) {
        continue;
      }
      if (!defn || typeof defn !== 'object') continue;
      const d = defn as Record<string, unknown>;
      const props = d.properties as Record<string, unknown> | undefined;
      const argsSchema = props?.args ?? d.args ?? d.parameters;
      const paramSchema =
        argsSchema && typeof argsSchema === 'object'
          ? convertFunctionArgsJsonSchemaToZod(argsSchema as Record<string, unknown>, rootDoc)
          : z.record(z.unknown());
      const returnType =
        (typeof d.returnType === 'string' ? d.returnType : undefined) ??
        (typeof (props?.returnType as Record<string, unknown> | undefined)?.const === 'string'
          ? (props?.returnType as Record<string, unknown>).const
          : 'any');
      const allowedCallers =
        d.allowedCallers ?? (props?.allowedCallers as Record<string, unknown> | undefined)?.const;
      const requiresUserActivation =
        d.requiresUserActivation ??
        (props?.requiresUserActivation as Record<string, unknown> | undefined)?.const;

      result.push({
        name,
        description: typeof d.description === 'string' ? d.description : undefined,
        returnType: returnType as any,
        allowedCallers: allowedCallers as any,
        requiresUserActivation: requiresUserActivation as boolean | undefined,
        schema: paramSchema,
      });
    }
  }

  return result;
}

function extractPermittedNames(oneOf: unknown, prefix: string): Set<string> | undefined {
  if (!Array.isArray(oneOf)) return undefined;
  const permitted = new Set<string>();
  for (const item of oneOf) {
    if (typeof item?.$ref === 'string' && item.$ref.startsWith(prefix)) {
      const rawName = item.$ref.slice(prefix.length);
      const unescapedName = rawName.replace(/~([01])/g, (_: string, p1: string) =>
        p1 === '1' ? '/' : '~',
      );
      permitted.add(unescapedName);
    }
  }
  return permitted;
}

/**
 * Loads a raw A2UI catalog schema into a typed Catalog instance.
 *
 * Parses component and function definitions, extracts hierarchy constraints (`allowedParents`,
 * `allowedChildren`), unescapes RFC 6901 JSON pointers, and builds runtime Zod validators.
 *
 * @param catalogSchema Raw catalog schema or capabilities definition object.
 * @returns Fully-typed Catalog instance configured with components, functions, and metadata.
 * @throws {Error} If the catalog ID is missing or not a string.
 */
export function loadCatalogFromSchema(
  catalogSchema: Record<string, unknown>,
): Catalog<ComponentApi, FunctionApi> {
  const catalogId = catalogSchema.catalogId ?? catalogSchema.$id ?? catalogSchema.id;
  if (!catalogId || typeof catalogId !== 'string') {
    throw new Error("Catalog ID must be specified via catalog metadata ('catalogId' or '$id').");
  }

  // Filter permitted components via anyComponent.oneOf if declared
  const defs = catalogSchema.$defs as Record<string, unknown> | undefined;
  const anyComp = defs?.anyComponent as Record<string, unknown> | undefined;
  const permittedNames = extractPermittedNames(anyComp?.oneOf, '#/components/');

  const components: ComponentApi[] = [];
  const componentsMap = (catalogSchema.components as Record<string, unknown>) ?? {};
  for (const [name, rawCompSchema] of Object.entries(componentsMap)) {
    if (!permittedNames || permittedNames.has(name)) {
      const rawComp = (rawCompSchema as Record<string, unknown>) || {};
      const zodSchema = convertComponentJsonSchemaToZod(rawComp, catalogSchema);
      components.push({
        name,
        schema: zodSchema,
        allowedParents: Array.isArray(rawComp.allowedParents)
          ? rawComp.allowedParents.filter((p: unknown): p is string => typeof p === 'string')
          : undefined,
        allowedChildren: Array.isArray(rawComp.allowedChildren)
          ? rawComp.allowedChildren.filter((c: unknown): c is string => typeof c === 'string')
          : undefined,
      });
    }
  }

  // Filter permitted functions via anyFunction.oneOf if declared
  const anyFunc = defs?.anyFunction as Record<string, unknown> | undefined;
  const permittedFunctionNames = extractPermittedNames(anyFunc?.oneOf, '#/functions/');

  const functions = parseFunctionDefinitions(
    catalogSchema.functions,
    catalogSchema,
    permittedFunctionNames,
  );

  const rawTheme =
    catalogSchema.theme ??
    catalogSchema.themeSchema ??
    (defs?.theme as Record<string, unknown> | undefined);
  const themeSchema =
    rawTheme && typeof rawTheme === 'object'
      ? convertComponentJsonSchemaToZod(rawTheme as Record<string, unknown>, catalogSchema, false)
      : undefined;
  const instructions =
    typeof catalogSchema.instructions === 'string' ? catalogSchema.instructions : undefined;

  return new Catalog(catalogId, components, functions, themeSchema, instructions);
}
