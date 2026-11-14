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

// ponytail: removed with the zod mirrors in Task 11. `Catalog.fromJson`
// validates with the catalog's JSON Schema validator; this converter is left
// for what has no validator to hand: the plain JSON Schema `schema` of an
// `AgentFunction`, read into Zod (`convertFunctionArgsJsonSchemaToZod`), and
// the declared keys of a Zod agent function schema (`getDeclaredSchemaKeys`).

import {z} from 'zod';

import {CommonSchemas, ComponentCommonSchema} from '../types/common-types.js';
import {exclusiveUnion} from './exclusive_union.js';
import {canonicalJsonStringify, isShorthandParameterMap, resolveJsonPointer} from './from-json.js';

/**
 * Resolves a standard protocol `$ref` to its corresponding common type schema.
 *
 * @param ref JSON Schema reference string.
 * @returns The matching Zod schema, or undefined if not a known protocol definition.
 */
function resolveProtocolRef(ref: string): z.ZodTypeAny | undefined {
  const defName = ref.split(/#\/(?:\$defs|definitions)\//)[1];
  return defName && Object.hasOwn(CommonSchemas, defName)
    ? (CommonSchemas as Record<string, z.ZodTypeAny>)[defName]
    : undefined;
}

/**
 * Converts an array of JSON Schema enum values to a Zod schema.
 *
 * @param values Allowed enum values.
 * @returns Zod enum, literal, or union schema representing the allowed values.
 */
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

/**
 * Applies `not`, `default`, and `description` modifiers to a converted Zod schema.
 *
 * @param baseZod Base Zod schema before modifiers.
 * @param propSchema Raw property schema definition.
 * @param rootDoc Optional root schema document for resolving nested references.
 * @param visitedPointers Set of JSON pointer references currently being resolved.
 * @param defCache Cache of previously converted definition schemas.
 * @returns The modified Zod schema.
 */
function finalizePropertyZod(
  baseZod: z.ZodTypeAny,
  propSchema: Record<string, unknown>,
  rootDoc?: Record<string, unknown>,
  visitedPointers?: Set<string>,
  defCache?: Map<string, z.ZodTypeAny>,
): z.ZodTypeAny {
  let result = baseZod;
  if (propSchema.not && typeof propSchema.not === 'object') {
    const notSchema = convertPropertyToZod(
      propSchema.not as Record<string, unknown>,
      rootDoc,
      new Set(visitedPointers),
      defCache,
    );
    // Checks the value as written, before `baseZod` fills in the defaults of
    // its properties, which `not` must not see.
    result = z.preprocess((val, ctx) => {
      if (notSchema.safeParse(val).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Value matched prohibited "not" schema',
        });
      }
      return val;
    }, result);
  }
  if (propSchema.default !== undefined) {
    result = result.default(propSchema.default);
  }
  if (typeof propSchema.description === 'string') {
    result = result.describe(propSchema.description);
  }
  return result;
}

/**
 * Converts a JSON Schema `$ref` pointer into a Zod schema.
 *
 * Resolves standard protocol definitions from common types, as well as local
 * `#/$defs/...` pointers within the root document. Handles recursive references
 * using `z.lazy` and caches resolved schemas to break cycles.
 *
 * @param ref JSON Schema reference string.
 * @param propSchema Property schema containing the reference.
 * @param rootDoc Root schema document containing definition targets.
 * @param visitedPointers Set of reference pointers currently on the resolution stack.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @returns Converted Zod schema, or undefined if the reference cannot be resolved.
 */
function convertRefToZod(
  ref: string,
  propSchema: Record<string, unknown>,
  rootDoc: Record<string, unknown> | undefined,
  visitedPointers: Set<string>,
  defCache: Map<string, z.ZodTypeAny>,
): z.ZodTypeAny | undefined {
  const resolvedProtocol = resolveProtocolRef(ref);
  if (resolvedProtocol) {
    const defName = ref.split(/#\/(?:\$defs|definitions)\//)[1];
    const desc =
      typeof propSchema.description === 'string'
        ? `REF:common_types.json#/$defs/${defName}|${propSchema.description}`
        : resolvedProtocol.description;
    return desc ? resolvedProtocol.describe(desc) : resolvedProtocol;
  }

  if (rootDoc && ref.startsWith('#/')) {
    const localTarget = resolveJsonPointer(rootDoc, ref);
    if (!localTarget) {
      return z.unknown().superRefine((_val, ctx) => {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unresolvable schema reference: '${ref}'`,
        });
      });
    }
    if (visitedPointers.has(ref)) {
      let cached = defCache.get(ref);
      return z.lazy(() => {
        if (!cached) {
          cached =
            defCache.get(ref) ??
            convertPropertyToZod(localTarget, rootDoc, new Set([ref]), defCache);
          defCache.set(ref, cached);
        }
        return cached;
      });
    }
    let zodType = defCache.get(ref);
    if (!zodType) {
      const nextVisited = new Set(visitedPointers);
      nextVisited.add(ref);
      zodType = convertPropertyToZod(localTarget, rootDoc, nextVisited, defCache);
      defCache.set(ref, zodType);
    }
    if (typeof propSchema.description === 'string') {
      zodType = zodType.describe(propSchema.description);
    }
    return zodType;
  }
  return undefined;
}

/**
 * Converts `oneOf` or `anyOf` JSON Schema unions into a Zod schema.
 *
 * Enforces mutual exclusivity for `oneOf` unions by verifying that valid values
 * match exactly one branch. Preserves metadata such as `default`, `description`,
 * and dynamic string annotations for enum/DataBinding unions.
 *
 * @param propSchema Schema containing `oneOf` or `anyOf` branches.
 * @param rootDoc Root schema document for resolving nested references.
 * @param visitedPointers Set of reference pointers currently on the resolution stack.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @returns Converted Zod union schema, or undefined if no valid branches exist.
 */
function convertUnionToZod(
  propSchema: Record<string, unknown>,
  rootDoc: Record<string, unknown> | undefined,
  visitedPointers: Set<string>,
  defCache: Map<string, z.ZodTypeAny>,
): z.ZodTypeAny | undefined {
  const isOneOf = Array.isArray(propSchema.oneOf);
  const rawBranches = (propSchema.oneOf || propSchema.anyOf) as unknown[];
  const branches = rawBranches.filter(
    (b): b is Record<string, unknown> => typeof b === 'object' && b !== null,
  );
  if (branches.length === 0) return undefined;

  const enumBranch = branches.find(b => Array.isArray(b.enum));
  const hasBinding = branches.some(
    b => typeof b.$ref === 'string' && b.$ref.includes('DataBinding'),
  );
  const zodBranches = branches.map(b =>
    convertPropertyToZod(b, rootDoc, new Set(visitedPointers), defCache),
  );

  let unionZod: z.ZodTypeAny;
  if (zodBranches.length === 1) {
    unionZod = zodBranches[0];
  } else {
    const tuple = [zodBranches[0], zodBranches[1], ...zodBranches.slice(2)] as const;
    unionZod = isOneOf ? exclusiveUnion(tuple) : z.union(tuple);
  }

  if (propSchema.default !== undefined) {
    unionZod = unionZod.default(propSchema.default);
  }
  const desc =
    (typeof propSchema.description === 'string' ? propSchema.description : undefined) ||
    (enumBranch && hasBinding ? 'REF:common_types.json#/$defs/DynamicString' : undefined);
  return desc ? unionZod.describe(desc) : unionZod;
}

/**
 * Converts an `allOf`-composed JSON Schema property or leaf `$defs` entry into a Zod schema.
 *
 * When all branches contribute object property definitions (inline or via `#/$defs/...`),
 * merges their properties and required sets into a single `z.object(...)` respecting
 * `additionalProperties` / `unevaluatedProperties`. Otherwise, intersects the converted
 * branch schemas with `.and(...)`.
 */
function convertAllOfPropertyToZod(
  propSchema: Record<string, unknown>,
  rootDoc: Record<string, unknown> | undefined,
  visitedPointers: Set<string>,
  defCache: Map<string, z.ZodTypeAny>,
): z.ZodTypeAny | undefined {
  const rawBranches = propSchema.allOf as unknown[];
  const branches = rawBranches.filter(
    (b): b is Record<string, unknown> => typeof b === 'object' && b !== null,
  );
  if (branches.length === 0) return undefined;

  if (rootDoc) {
    const subSchemas = collectComponentSubSchemas(
      propSchema,
      rootDoc,
      new Set(visitedPointers),
      false,
    );
    if (subSchemas.length > 0) {
      const requiredSet = new Set<string>();
      for (const s of subSchemas) {
        if (s.kind === 'json' && Array.isArray(s.schema.required)) {
          for (const r of s.schema.required) {
            if (typeof r === 'string') requiredSet.add(r);
          }
        }
      }
      if (Array.isArray(propSchema.required)) {
        for (const r of propSchema.required) {
          if (typeof r === 'string') requiredSet.add(r);
        }
      }
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const s of subSchemas) {
        if (s.kind === 'zod') {
          Object.assign(shape, s.properties);
          continue;
        }
        const propShape = convertPropertiesToShape(
          (s.schema.properties as Record<string, unknown>) || {},
          requiredSet,
          rootDoc,
          new Set(visitedPointers),
          defCache,
        );
        Object.assign(shape, propShape);
      }
      const baseObj = z.object(shape);
      const forbidExtra =
        propSchema.additionalProperties === false ||
        propSchema.unevaluatedProperties === false ||
        subSchemas.some(
          s =>
            s.kind === 'json' &&
            (s.schema.additionalProperties === false || s.schema.unevaluatedProperties === false),
        );
      const obj = closeObjectSchema(
        baseObj,
        [
          propSchema,
          ...subSchemas.flatMap(s =>
            s.kind === 'json' && s.schema !== propSchema ? [s.schema] : [],
          ),
        ],
        forbidExtra,
        rootDoc,
        visitedPointers,
        defCache,
      );
      return finalizePropertyZod(obj, propSchema, rootDoc, visitedPointers, defCache);
    }
  }

  const zodBranches = branches.map(b =>
    convertPropertyToZod(b, rootDoc, new Set(visitedPointers), defCache),
  );
  let intersected = zodBranches[0];
  for (let i = 1; i < zodBranches.length; i++) {
    intersected = intersected.and(zodBranches[i]);
  }
  return finalizePropertyZod(intersected, propSchema, rootDoc, visitedPointers, defCache);
}

/**
 * Converts a JSON Schema property definition into a runtime Zod schema.
 *
 * Handles `$ref` pointers, unions (`oneOf`, `anyOf`), enums, const values,
 * arrays with boundary constraints and uniqueness, strings with length and pattern
 * validations, numbers with minimum/maximum/multipleOf bounds, booleans, and nested
 * objects with property maps and additionalProperties constraints.
 *
 * @param propSchema Raw JSON Schema property definition.
 * @param rootDoc Optional root schema document for resolving references.
 * @param visitedPointers Set of reference pointers currently being resolved.
 * @param defCache Cache of resolved definition schemas to handle recursion and avoid duplicate work.
 * @returns Runtime Zod schema enforcing the declared JSON Schema constraints.
 */
function convertPropertyToZod(
  propSchema: Record<string, unknown>,
  rootDoc?: Record<string, unknown>,
  visitedPointers = new Set<string>(),
  defCache = new Map<string, z.ZodTypeAny>(),
): z.ZodTypeAny {
  if (!propSchema || typeof propSchema !== 'object') {
    return z.unknown();
  }
  if (propSchema instanceof z.ZodType) {
    return propSchema;
  }

  if (propSchema.$ref && typeof propSchema.$ref === 'string') {
    const resolvedRef = convertRefToZod(
      propSchema.$ref,
      propSchema,
      rootDoc,
      visitedPointers,
      defCache,
    );
    if (resolvedRef) return resolvedRef;
  }

  // oneOf / anyOf inspection
  if (Array.isArray(propSchema.oneOf) || Array.isArray(propSchema.anyOf)) {
    const resolvedUnion = convertUnionToZod(propSchema, rootDoc, visitedPointers, defCache);
    if (resolvedUnion) return resolvedUnion;
  }

  // allOf inspection
  if (Array.isArray(propSchema.allOf) && propSchema.allOf.length > 0) {
    const resolvedAllOf = convertAllOfPropertyToZod(propSchema, rootDoc, visitedPointers, defCache);
    if (resolvedAllOf) return resolvedAllOf;
  }

  // Const literal
  if (propSchema.const !== undefined) {
    const constZod = z.literal(propSchema.const as string | number | boolean);
    return finalizePropertyZod(constZod, propSchema, rootDoc, visitedPointers, defCache);
  }

  // Enums
  if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    const enumZod = convertEnumToZod(propSchema.enum);
    return finalizePropertyZod(enumZod, propSchema, rootDoc, visitedPointers, defCache);
  }

  // Arrays
  if (propSchema.type === 'array') {
    const itemSchema =
      propSchema.items && typeof propSchema.items === 'object'
        ? convertPropertyToZod(
            propSchema.items as Record<string, unknown>,
            rootDoc,
            new Set(visitedPointers),
            defCache,
          )
        : z.unknown();
    let arr: z.ZodTypeAny = z.array(itemSchema);
    if (typeof propSchema.minItems === 'number') {
      arr = (arr as z.ZodArray<any>).min(propSchema.minItems);
    }
    if (typeof propSchema.maxItems === 'number') {
      arr = (arr as z.ZodArray<any>).max(propSchema.maxItems);
    }
    if (propSchema.uniqueItems === true) {
      arr = arr.refine(
        (items: unknown[]) => new Set(items.map(canonicalJsonStringify)).size === items.length,
        {message: 'Array items must be unique'},
      );
    }
    return finalizePropertyZod(arr, propSchema, rootDoc, visitedPointers, defCache);
  }

  // Primitives
  switch (propSchema.type) {
    case 'string': {
      let s = z.string();
      if (typeof propSchema.minLength === 'number') {
        s = s.min(propSchema.minLength);
      }
      if (typeof propSchema.maxLength === 'number') {
        s = s.max(propSchema.maxLength);
      }
      if (typeof propSchema.pattern === 'string') {
        try {
          s = s.regex(new RegExp(propSchema.pattern, 'u'));
        } catch {
          // ignore regex compilation failure
        }
      }
      return finalizePropertyZod(s, propSchema, rootDoc, visitedPointers, defCache);
    }
    case 'integer':
    case 'number': {
      let n = propSchema.type === 'integer' ? z.number().int() : z.number();
      if (typeof propSchema.minimum === 'number') {
        n = n.min(propSchema.minimum);
      }
      if (typeof propSchema.maximum === 'number') {
        n = n.max(propSchema.maximum);
      }
      if (typeof propSchema.exclusiveMinimum === 'number') {
        n = n.gt(propSchema.exclusiveMinimum);
      }
      if (typeof propSchema.exclusiveMaximum === 'number') {
        n = n.lt(propSchema.exclusiveMaximum);
      }
      if (typeof propSchema.multipleOf === 'number') {
        n = n.multipleOf(propSchema.multipleOf);
      }
      return finalizePropertyZod(n, propSchema, rootDoc, visitedPointers, defCache);
    }
    case 'boolean': {
      return finalizePropertyZod(z.boolean(), propSchema, rootDoc, visitedPointers, defCache);
    }
    case 'object': {
      // An inline object that declares its properties is converted structurally
      // rather than collapsed to an opaque record. Without this, a child
      // reference nested inside an array item is invisible to the reference map,
      // so the component graph would look as if it had no children there.
      const props = propSchema.properties;
      const hasPatterns =
        typeof propSchema.patternProperties === 'object' && propSchema.patternProperties !== null;
      let obj: z.ZodTypeAny;
      if ((typeof props === 'object' && props !== null) || hasPatterns) {
        const required = Array.isArray(propSchema.required)
          ? new Set(propSchema.required.filter((r): r is string => typeof r === 'string'))
          : new Set<string>();
        const baseObj = z.object(
          convertPropertiesToShape(
            (props ?? {}) as Record<string, unknown>,
            required,
            rootDoc,
            visitedPointers,
            defCache,
          ),
        );
        const forbidExtra =
          propSchema.additionalProperties === false || propSchema.unevaluatedProperties === false;
        obj = closeObjectSchema(
          baseObj,
          [propSchema],
          forbidExtra,
          rootDoc,
          visitedPointers,
          defCache,
        );
      } else {
        obj = z.record(z.unknown());
      }
      return finalizePropertyZod(obj, propSchema, rootDoc, visitedPointers, defCache);
    }
    default: {
      return finalizePropertyZod(z.unknown(), propSchema, rootDoc, visitedPointers, defCache);
    }
  }
}

/**
 * Converts a dictionary of property definitions into a Zod raw shape map.
 *
 * Marks fields as optional unless present in `requiredSet`.
 *
 * @param properties Property name to property schema mapping.
 * @param requiredSet Set of required property names.
 * @param rootDoc Optional root schema document for reference resolution.
 * @param visitedPointers Set of reference pointers currently on the resolution stack.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @returns Map of property names to Zod schemas representing the shape.
 */
function convertPropertiesToShape(
  properties: Record<string, unknown>,
  requiredSet: Set<string>,
  rootDoc?: Record<string, unknown>,
  visitedPointers?: Set<string>,
  defCache = new Map<string, z.ZodTypeAny>(),
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [propName, propSchema] of Object.entries(properties)) {
    const zodField = convertPropertyToZod(
      typeof propSchema === 'object' && propSchema !== null
        ? (propSchema as Record<string, unknown>)
        : {},
      rootDoc,
      visitedPointers ? new Set(visitedPointers) : new Set<string>(),
      defCache,
    );
    if (!requiredSet.has(propName)) {
      // A property with a `default` already accepts a missing value, and
      // `optional()` would skip the default. Leaving it unwrapped applies the
      // default on parse, as a `.default()` in a catalog defined in code does.
      shape[propName] = zodField instanceof z.ZodDefault ? zodField : zodField.optional();
      continue;
    }
    if (zodField.safeParse(undefined).success) {
      // A required property must be present. A schema that accepts any value,
      // such as `{}`, also accepts a missing key, and a `default` would stand
      // in for one, so a missing key is rejected before either applies.
      shape[propName] = z.preprocess((value, ctx) => {
        if (value === undefined) {
          ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Required'});
        }
        return value;
      }, zodField);
    } else {
      shape[propName] = zodField;
    }
  }
  return shape;
}

/**
 * Closes or opens a converted object schema, honoring the `patternProperties`
 * of the JSON Schema pieces it was built from.
 *
 * Without `patternProperties` this is `.strict()` or `.passthrough()`. With
 * them, a key the object doesn't declare is checked against the schema of
 * every pattern it matches, and when `forbidExtra` is set, a key that matches
 * no pattern is rejected, as `additionalProperties: false` rejects it.
 *
 * @param obj The object schema of the declared properties.
 * @param pieces The JSON Schema pieces whose `patternProperties` apply.
 * @param forbidExtra Whether keys that are neither declared nor matched are rejected.
 * @param rootDoc Optional root schema document for reference resolution.
 * @param visitedPointers Set of reference pointers currently on the resolution stack.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @returns The object schema, wrapped in a refinement when patterns apply.
 */
function closeObjectSchema(
  obj: z.AnyZodObject,
  pieces: ReadonlyArray<Record<string, unknown>>,
  forbidExtra: boolean,
  rootDoc?: Record<string, unknown>,
  visitedPointers?: Set<string>,
  defCache = new Map<string, z.ZodTypeAny>(),
): z.ZodTypeAny {
  const patterns: Array<{regex: RegExp; schema: z.ZodTypeAny}> = [];
  for (const piece of new Set(pieces)) {
    const raw = piece.patternProperties;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    for (const [pattern, patternSchema] of Object.entries(raw as Record<string, unknown>)) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'u');
      } catch {
        continue;
      }
      patterns.push({
        regex,
        schema: convertPropertyToZod(
          typeof patternSchema === 'object' && patternSchema !== null
            ? (patternSchema as Record<string, unknown>)
            : {},
          rootDoc,
          visitedPointers ? new Set(visitedPointers) : new Set<string>(),
          defCache,
        ),
      });
    }
  }
  if (patterns.length === 0) {
    return forbidExtra ? obj.strict() : obj.passthrough();
  }
  const declared = new Set(Object.keys(obj.shape));
  return obj.passthrough().superRefine((value, ctx) => {
    const unrecognized: string[] = [];
    for (const [key, entry] of Object.entries(value)) {
      if (declared.has(key)) continue;
      let matched = false;
      for (const {regex, schema} of patterns) {
        if (!regex.test(key)) continue;
        matched = true;
        const result = schema.safeParse(entry);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: issue.message,
              path: [key, ...issue.path],
            });
          }
        }
      }
      if (!matched && forbidExtra) unrecognized.push(key);
    }
    if (unrecognized.length > 0) {
      ctx.addIssue({code: z.ZodIssueCode.unrecognized_keys, keys: unrecognized});
    }
  });
}

/**
 * A piece of a component definition gathered while flattening `allOf`.
 *
 * Most pieces are raw JSON Schema fragments taken from the catalog document. A piece that
 * comes from an external `$ref` into `common_types.json` cannot be read as JSON here, since
 * only the catalog document is loaded, so it arrives as the zod mirror of the canonical
 * type instead.
 */
type ComponentSubSchema =
  | {kind: 'json'; schema: Record<string, unknown>}
  | {kind: 'zod'; properties: Record<string, z.ZodTypeAny>};

/**
 * Returns the `ComponentCommon` properties a component schema that composes
 * `common_types.json#/$defs/ComponentCommon` inherits.
 *
 * The component's `id` and catalog are envelope fields rather than
 * properties, and below v1.0 `metadata` is not part of the protocol.
 *
 * @param isAtLeastV10 Whether the catalog targets protocol v1.0 or higher.
 * @returns The inherited property schemas, keyed by their wire names.
 */
function componentCommonMixinProperties(isAtLeastV10: boolean): Record<string, z.ZodTypeAny> {
  const properties: Record<string, z.ZodTypeAny> = {};
  for (const [key, schema] of Object.entries(ComponentCommonSchema.shape)) {
    if (!isAtLeastV10 && key.startsWith('@')) continue;
    const bareKey = key.replace(/^@/, '');
    if (bareKey === 'id' || bareKey === 'catalogId') continue;
    if (bareKey === 'metadata' && !isAtLeastV10) continue;
    properties[key] = schema as z.ZodTypeAny;
  }
  return properties;
}

/**
 * Collects all property definitions and constraints from a component schema.
 *
 * Resolves local document `$defs` and canonical protocol references, including
 * external `common_types.json` mixins such as `Checkable`.
 *
 * The pieces are ordered from the most generic to the most specific, so that a
 * later piece overrides a property an earlier one declares: the standard
 * mixins first, then the local definitions the schema references, then its
 * inline `allOf` members, and the schema's own `properties` last. A component
 * that narrows a property it inherits keeps its narrowed schema, and the mixin
 * properties stay first in key order.
 *
 * @param schema Component schema definition.
 * @param rootDoc Root schema document containing definition targets.
 * @param visitedPointers Set of reference pointers currently being resolved to prevent cycles.
 * @param isAtLeastV10 Whether the catalog targets protocol v1.0 or higher.
 * @returns The pieces gathered from the schema and its `allOf` hierarchy, as JSON Schema
 *     fragments or zod mirrors of canonical types, least specific first.
 */
function collectComponentSubSchemas(
  schema: Record<string, unknown>,
  rootDoc: Record<string, unknown>,
  visitedPointers = new Set<string>(),
  isAtLeastV10 = false,
): ComponentSubSchema[] {
  if (!schema || typeof schema !== 'object') return [];
  const mixins: ComponentSubSchema[] = [];
  const local: ComponentSubSchema[] = [];
  const inline: ComponentSubSchema[] = [];

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (!sub || typeof sub !== 'object') continue;

      if (typeof sub.$ref === 'string') {
        const ref = sub.$ref;
        if (ref.includes('common_types.json') && ref.includes('ComponentCommon')) {
          // Protocol common properties: accessibility attributes, and from
          // v1.0 also the component's metadata, under their bare or
          // `@`-prefixed names. `catalogId` is an envelope field, like `id`.
          mixins.push({kind: 'zod', properties: componentCommonMixinProperties(isAtLeastV10)});
        } else if (ref.startsWith('#/')) {
          if (!visitedPointers.has(ref)) {
            visitedPointers.add(ref);
            const target = resolveJsonPointer(rootDoc, ref);
            if (target) {
              local.push(
                ...collectComponentSubSchemas(target, rootDoc, visitedPointers, isAtLeastV10),
              );
            }
          }
        } else {
          // Any other external reference, such as common_types.json#/$defs/Checkable.
          // The referenced document is not loaded here, so fall back to the zod mirror of
          // the canonical type. Without this the mixin is dropped with no error, which is
          // how `checks` used to disappear from every Checkable component.
          const mirror = resolveProtocolRef(ref);
          if (mirror instanceof z.ZodObject) {
            const properties: Record<string, z.ZodTypeAny> = {};
            for (const [key, prop] of Object.entries(mirror.shape as z.ZodRawShape)) {
              if (!isAtLeastV10 && key.startsWith('@')) continue;
              properties[key] = prop;
            }
            mixins.push({kind: 'zod', properties});
          }
        }
      } else {
        inline.push(...collectComponentSubSchemas(sub, rootDoc, visitedPointers, isAtLeastV10));
      }
    }
  }

  const result = [...mixins, ...local, ...inline];
  if (schema.properties) {
    result.push({kind: 'json', schema});
  }
  return result;
}

/**
 * Checks whether an object schema explicitly permits additional or unevaluated properties.
 */
function isExplicitlyOpen(schema: Record<string, unknown>): boolean {
  return (
    schema.unevaluatedProperties === true ||
    (typeof schema.unevaluatedProperties === 'object' && schema.unevaluatedProperties !== null) ||
    schema.additionalProperties === true ||
    (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null)
  );
}

/**
 * Collects sub-schemas and references for function argument definitions.
 *
 * Resolves local document pointers (`#/`), recurses into `allOf` compositions,
 * and detects unresolvable references or open combiners (`oneOf`, `anyOf`).
 */
function collectArgSubSchemas(
  schema: Record<string, unknown>,
  rootDoc?: Record<string, unknown>,
  visited = new Set<string>(),
): {schemas: Record<string, unknown>[]; hasUnresolvable: boolean} {
  const result: {schemas: Record<string, unknown>[]; hasUnresolvable: boolean} = {
    schemas: [],
    hasUnresolvable: false,
  };

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return result;
  }

  if (isShorthandParameterMap(schema)) {
    result.schemas.push({
      type: 'object',
      properties: schema,
    });
    return result;
  }

  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (ref.startsWith('#/')) {
      if (!rootDoc) {
        result.hasUnresolvable = true;
      } else if (!visited.has(ref)) {
        visited.add(ref);
        const target = resolveJsonPointer(rootDoc, ref);
        if (target) {
          const sub = collectArgSubSchemas(target, rootDoc, visited);
          result.schemas.push(...sub.schemas);
          if (sub.hasUnresolvable) {
            result.hasUnresolvable = true;
          }
        } else {
          result.hasUnresolvable = true;
        }
      }
    } else {
      result.hasUnresolvable = true;
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        const subResult = collectArgSubSchemas(sub as Record<string, unknown>, rootDoc, visited);
        result.schemas.push(...subResult.schemas);
        if (subResult.hasUnresolvable) {
          result.hasUnresolvable = true;
        }
      }
    }
  }

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    result.hasUnresolvable = true;
  }

  if (
    schema.properties ||
    schema.required ||
    schema.patternProperties ||
    schema.additionalProperties !== undefined ||
    schema.unevaluatedProperties !== undefined
  ) {
    result.schemas.push(schema);
  }

  return result;
}

/**
 * Converts a function argument JSON schema definition into a Zod object schema.
 *
 * Maps function argument schemas to object properties, requiring fields listed in
 * `required` and applying strictness or passthrough based on `additionalProperties`,
 * `patternProperties` and reference resolution.
 *
 * @param rawSchema Raw function arguments schema.
 * @param rootDoc Optional root schema document for reference resolution.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @returns Zod object schema validating function arguments, wrapped in a
 *     refinement when `patternProperties` apply.
 */
export function convertFunctionArgsJsonSchemaToZod(
  rawSchema: Record<string, unknown>,
  rootDoc?: Record<string, unknown>,
  defCache = new Map<string, z.ZodTypeAny>(),
): z.ZodTypeAny {
  const collected = collectArgSubSchemas(rawSchema, rootDoc);
  const requiredSet = new Set<string>();
  for (const s of collected.schemas) {
    if (Array.isArray(s.required)) {
      for (const r of s.required) {
        if (typeof r === 'string') {
          requiredSet.add(r);
        }
      }
    }
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const s of collected.schemas) {
    if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
      const propShape = convertPropertiesToShape(
        s.properties as Record<string, unknown>,
        requiredSet,
        rootDoc,
        undefined,
        defCache,
      );
      Object.assign(shape, propShape);
    }
  }

  const obj = z.object(shape);
  const allowExtra =
    collected.hasUnresolvable ||
    collected.schemas.some(isExplicitlyOpen) ||
    isExplicitlyOpen(rawSchema);
  return closeObjectSchema(
    obj,
    [rawSchema, ...collected.schemas.filter(s => s !== rawSchema)],
    !allowExtra,
    rootDoc,
    undefined,
    defCache,
  );
}

/**
 * Whether a value is a Zod schema. Checked structurally so schemas built with
 * another copy of Zod are recognized.
 */
export function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {safeParse?: unknown}).safeParse === 'function'
  );
}

/**
 * Collects every object property key a Zod schema declares.
 *
 * Unlike `getKnownSchemaKeys`, which answers which keys an object may have, it
 * also collects the keys of an open (`.passthrough()`) object, and of every
 * branch of a union. It traverses `ZodEffects`, `ZodOptional`, `ZodNullable`,
 * `ZodDefault`, `ZodCatch`, `ZodIntersection`, `ZodUnion`,
 * `ZodDiscriminatedUnion`, `ZodPipeline`, `ZodReadonly` and `ZodBranded`.
 *
 * @param schema Zod schema to inspect.
 * @returns The declared property names; empty when the schema declares none.
 */
export function getDeclaredSchemaKeys(schema: z.ZodTypeAny): Set<string> {
  const keys = new Set<string>();
  const visit = (node: any): void => {
    const def = node?._def;
    switch (def?.typeName) {
      case 'ZodObject': {
        const shape = typeof node.shape === 'function' ? node.shape() : node.shape;
        if (shape && typeof shape === 'object') {
          for (const key of Object.keys(shape)) keys.add(key);
        }
        return;
      }
      case 'ZodEffects':
        visit(def.schema);
        return;
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodDefault':
      case 'ZodCatch':
      case 'ZodReadonly':
        visit(def.innerType);
        return;
      case 'ZodBranded':
        visit(def.type);
        return;
      case 'ZodPipeline':
        visit(def.in);
        visit(def.out);
        return;
      case 'ZodIntersection':
        visit(def.left);
        visit(def.right);
        return;
      case 'ZodUnion':
      case 'ZodDiscriminatedUnion':
        for (const option of def.options) visit(option);
        return;
      default:
        return;
    }
  };
  visit(schema);
  return keys;
}
