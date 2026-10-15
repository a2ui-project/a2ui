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
  ComponentCommonSchema,
  DataBindingSchema,
  FunctionCallSchema,
  ChildSchema,
} from '../types/common-types.js';
import type {CatalogDocumentOptions, ComponentApi, FunctionApi} from './types.js';
import {isAtLeastVersion} from '../common/semver.js';
import {JsonComponentApi, JsonFunctionApi} from './json_entries.js';
import {
  buildComponentUnion,
  buildFunctionUnion,
  deepCopyJson,
  deepFreeze,
} from './schema_serializer.js';

/**
 * The fields of a parsed catalog document: its ID, version and entries, and
 * the document-level fields a `Catalog` keeps so that `toJson` reproduces the
 * document.
 */
export interface ParsedCatalogSchema extends CatalogDocumentOptions {
  id: string;
  protocolVersion: string;
  components: ComponentApi[];
  functions: FunctionApi[];
  themeSchema?: z.ZodObject<z.ZodRawShape>;
}

/**
 * Protocol version assumed for a catalog schema that does not declare one.
 *
 * Catalog schemas only began carrying `protocolVersion` at v1.0, so a schema
 * that omits it predates that field.
 */
export const DEFAULT_PROTOCOL_VERSION = '0.9';

import {assertUax31Identifier} from '../common/uax31.js';

const COMMON_TYPE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  DynamicString: DynamicStringSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicBoolean: DynamicBooleanSchema,
  DynamicStringList: DynamicStringListSchema,
  DynamicValue: DynamicValueSchema,
  ComponentId: ComponentIdSchema,
  Child: ChildSchema,
  ChildList: ChildListSchema,
  Action: ActionSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
  DataBinding: DataBindingSchema,
  FunctionCall: FunctionCallSchema,
};

/**
 * Resolves a JSON Pointer within a root JSON document.
 *
 * Follows RFC 6901 pointer unescaping (~1 -> /, ~0 -> ~).
 *
 * @param rootDoc Root JSON document to resolve within.
 * @param pointer RFC 6901 JSON pointer string.
 * @returns The resolved document subtree, or undefined if not found.
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

/**
 * Resolves a standard protocol `$ref` to its corresponding common type schema.
 *
 * @param ref JSON Schema reference string.
 * @returns The matching Zod schema, or undefined if not a known protocol definition.
 */
function resolveProtocolRef(ref: string): z.ZodTypeAny | undefined {
  const defName = ref.split(/#\/(?:\$defs|definitions)\//)[1];
  return defName ? COMMON_TYPE_SCHEMAS[defName] : undefined;
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
 * Serializes a value to canonical JSON with deterministically sorted object keys.
 *
 * Produces identical strings for semantically equivalent values regardless of
 * object property insertion order.
 *
 * @param val Value to serialize.
 * @returns Deterministic JSON string representation.
 */
function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(canonicalJsonStringify).join(',')}]`;
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const entries = keys.map(
    k => `${JSON.stringify(k)}:${canonicalJsonStringify((val as Record<string, unknown>)[k])}`,
  );
  return `{${entries.join(',')}}`;
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
    result = result.refine(val => !notSchema.safeParse(val).success, {
      message: 'Value matched prohibited "not" schema',
    });
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
    const baseUnion = z.union([zodBranches[0], zodBranches[1], ...zodBranches.slice(2)]);
    unionZod = isOneOf
      ? z
          .any()
          .superRefine((val, ctx) => {
            let matches = 0;
            for (const b of zodBranches) {
              if (b.safeParse(val).success && ++matches > 1) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: 'Value matched more than one schema in oneOf',
                });
                return;
              }
            }
          })
          .pipe(baseUnion)
      : baseUnion;
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
      let obj: z.ZodTypeAny;
      if (typeof props === 'object' && props !== null) {
        const required = Array.isArray(propSchema.required)
          ? new Set(propSchema.required.filter((r): r is string => typeof r === 'string'))
          : new Set<string>();
        const baseObj = z.object(
          convertPropertiesToShape(
            props as Record<string, unknown>,
            required,
            false,
            rootDoc,
            visitedPointers,
            defCache,
          ),
        );
        const forbidExtra =
          propSchema.additionalProperties === false || propSchema.unevaluatedProperties === false;
        obj = forbidExtra ? baseObj.strict() : baseObj.passthrough();
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
 * Whether a property name is one of the component envelope fields (`id`,
 * `component`, `catalogId`), which route a component rather than configure it.
 * The validation schema leaves them out of a component for the same reason, and
 * `PayloadValidator` strips them before parsing a component.
 *
 * @param propName Property name to check.
 * @returns True if the property belongs to the envelope rather than the component.
 */
function isEnvelopeField(propName: string): boolean {
  return propName === 'id' || propName === 'component' || propName === 'catalogId';
}

/**
 * Converts a dictionary of property definitions into a Zod raw shape map.
 *
 * Marks fields as optional unless present in `requiredSet`.
 *
 * @param properties Property name to property schema mapping.
 * @param requiredSet Set of required property names.
 * @param omitEnvelopeFields Whether to omit component envelope fields (`id`, `component`, `catalogId`).
 * @param rootDoc Optional root schema document for reference resolution.
 * @param visitedPointers Set of reference pointers currently on the resolution stack.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @returns Map of property names to Zod schemas representing the shape.
 */
function convertPropertiesToShape(
  properties: Record<string, unknown>,
  requiredSet: Set<string>,
  omitEnvelopeFields = false,
  rootDoc?: Record<string, unknown>,
  visitedPointers?: Set<string>,
  defCache = new Map<string, z.ZodTypeAny>(),
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [propName, propSchema] of Object.entries(properties)) {
    if (omitEnvelopeFields && isEnvelopeField(propName)) {
      continue;
    }
    const zodField = convertPropertyToZod(
      typeof propSchema === 'object' && propSchema !== null
        ? (propSchema as Record<string, unknown>)
        : {},
      rootDoc,
      visitedPointers ? new Set(visitedPointers) : new Set<string>(),
      defCache,
    );
    if (!requiredSet.has(propName)) {
      shape[propName] = zodField.optional();
    } else if (zodField.safeParse(undefined).success) {
      // A schema that accepts any value, such as `{}`, also accepts a missing
      // key, which `required` rules out.
      shape[propName] = zodField.refine(value => value !== undefined, {message: 'Required'});
    } else {
      shape[propName] = zodField;
    }
  }
  return shape;
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
          // v1.0 also the component's metadata. `catalogId` is an envelope
          // field, like `id`.
          const {accessibility, metadata} = ComponentCommonSchema.shape;
          mixins.push({
            kind: 'zod',
            properties: isAtLeastV10 ? {accessibility, metadata} : {accessibility},
          });
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
            mixins.push({kind: 'zod', properties: {...mirror.shape}});
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
 * Converts a raw component JSON schema definition into a Zod object schema.
 *
 * Merges sub-schemas from `allOf` compositions, applies required fields, and
 * respects `additionalProperties` and `unevaluatedProperties` constraints.
 *
 * @param rawSchema Raw component schema definition.
 * @param rootDoc Root schema document for resolving references.
 * @param omitEnvelopeFields Whether to omit envelope fields (`id`, `component`, `catalogId`). Defaults to true.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @param isAtLeastV10 Whether the catalog targets protocol v1.0 or higher.
 * @returns Zod object schema validating component properties.
 */
function convertComponentJsonSchemaToZod(
  rawSchema: Record<string, unknown>,
  rootDoc: Record<string, unknown>,
  omitEnvelopeFields = true,
  defCache = new Map<string, z.ZodTypeAny>(),
  isAtLeastV10 = false,
): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const schemasToMerge = collectComponentSubSchemas(rawSchema, rootDoc, undefined, isAtLeastV10);

  const requiredSet = new Set<string>();
  for (const s of schemasToMerge) {
    if (s.kind === 'json' && Array.isArray(s.schema.required)) {
      s.schema.required.forEach((r: unknown) => {
        if (typeof r === 'string') requiredSet.add(r);
      });
    }
  }

  for (const s of schemasToMerge) {
    if (s.kind === 'zod') {
      for (const [propName, propSchema] of Object.entries(s.properties)) {
        if (omitEnvelopeFields && isEnvelopeField(propName)) {
          continue;
        }
        shape[propName] = propSchema;
      }
      continue;
    }
    const propShape = convertPropertiesToShape(
      (s.schema.properties as Record<string, unknown>) || {},
      requiredSet,
      omitEnvelopeFields,
      rootDoc,
      undefined,
      defCache,
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

/**
 * Checks whether an object schema represents a shorthand parameter map (a map
 * of parameter names to subschemas), rather than a full JSON Schema object or
 * reference combinator.
 */
function isShorthandParameterMap(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return false;
  }
  const s = schema as Record<string, unknown>;
  return (
    Object.keys(s).length > 0 &&
    s.properties === undefined &&
    typeof s.type !== 'string' &&
    !('$ref' in s) &&
    !('allOf' in s) &&
    !('oneOf' in s) &&
    !('anyOf' in s) &&
    !('not' in s) &&
    Object.values(s).every(v => v !== null && (typeof v === 'object' || typeof v === 'boolean'))
  );
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
 * `required` and applying strictness or passthrough based on `additionalProperties`
 * and reference resolution.
 *
 * @param rawSchema Raw function arguments schema.
 * @param rootDoc Optional root schema document for reference resolution.
 * @param defCache Cache mapping reference strings to resolved Zod schemas.
 * @returns Zod object schema validating function arguments.
 */
function convertFunctionArgsJsonSchemaToZod(
  rawSchema: Record<string, unknown>,
  rootDoc?: Record<string, unknown>,
  defCache = new Map<string, z.ZodTypeAny>(),
): z.ZodObject<z.ZodRawShape> {
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
        false,
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
  return allowExtra ? obj.passthrough() : obj.strict();
}

/**
 * Extracts declared parameter names from a function's argument schema.
 */
function functionParameterNames(schema: unknown, rootDoc?: Record<string, unknown>): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [];
  }
  const s = schema as Record<string, unknown>;
  const names: string[] = [];
  const visited = new Set<string>();

  const extractProperties = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const n = node as Record<string, unknown>;
    if (typeof n.$ref === 'string' && rootDoc && n.$ref.startsWith('#/')) {
      if (!visited.has(n.$ref)) {
        visited.add(n.$ref);
        const target = resolveJsonPointer(rootDoc, n.$ref);
        if (target) {
          extractProperties(target);
        }
      }
    }
    if (
      n.properties &&
      typeof n.properties === 'object' &&
      n.properties !== null &&
      !Array.isArray(n.properties)
    ) {
      names.push(...Object.keys(n.properties as Record<string, unknown>));
    }
    if (Array.isArray(n.allOf)) {
      for (const member of n.allOf) {
        extractProperties(member);
      }
    }
  };

  if (
    (s.properties &&
      typeof s.properties === 'object' &&
      s.properties !== null &&
      !Array.isArray(s.properties)) ||
    Array.isArray(s.allOf) ||
    typeof s.$ref === 'string'
  ) {
    extractProperties(s);
    return names;
  }

  if (isShorthandParameterMap(s)) {
    return Object.keys(s);
  }

  return [];
}

/**
 * Parses raw catalog function definitions into typed FunctionApi objects.
 *
 * Validates UAX #31 identifier requirements when targeting protocol v1.0 or higher,
 * filters against permitted function names, and converts parameter schemas to Zod validators.
 *
 * @param rawFunctions Raw function definitions from the catalog schema (array or dictionary).
 * @param rootDoc Optional root schema document for reference resolution.
 * @param permittedNames Optional set of allowed function names from `anyFunction.oneOf`.
 * @param atLeastV10 Whether the catalog targets protocol v1.0 or higher.
 * @returns Array of parsed FunctionApi objects.
 * @throws {A2uiCatalogError} If a function or argument identifier fails UAX #31 validation in v1.0+.
 */
function parseFunctionDefinitions(
  rawFunctions: unknown,
  rootDoc?: Record<string, unknown>,
  permittedNames?: Set<string>,
  atLeastV10 = false,
): FunctionApi[] {
  const result: FunctionApi[] = [];
  if (!rawFunctions) return result;
  const defCache = new Map<string, z.ZodTypeAny>();

  /** Validates a function's own name and its declared argument names. */
  const assertFunctionIdentifiers = (name: string, paramNames: string[]): void => {
    if (!atLeastV10) return;
    assertUax31Identifier(name, `function identifier: '${name}'`);
    for (const argName of paramNames) {
      assertUax31Identifier(argName, `argument identifier: '${argName}' in function '${name}'`);
    }
  };

  if (Array.isArray(rawFunctions)) {
    for (const fn of rawFunctions) {
      if (fn && typeof fn === 'object' && typeof fn.name === 'string') {
        const paramNames = functionParameterNames(fn.parameters, rootDoc);
        assertFunctionIdentifiers(fn.name, paramNames);
        if (permittedNames && !permittedNames.has(fn.name)) {
          continue;
        }
        result.push(
          new JsonFunctionApi(fn.name, fn as Record<string, unknown>, definition =>
            definition['parameters'] && typeof definition['parameters'] === 'object'
              ? convertFunctionArgsJsonSchemaToZod(
                  definition['parameters'] as Record<string, unknown>,
                  rootDoc,
                  defCache,
                )
              : z.record(z.unknown()),
          ),
        );
      }
    }
    return result;
  }

  if (typeof rawFunctions === 'object' && rawFunctions !== null) {
    for (const [name, defn] of Object.entries(rawFunctions)) {
      const rawDefn = defn && typeof defn === 'object' ? (defn as Record<string, unknown>) : {};
      const argsSchema = functionArgsSchema(rawDefn);
      const paramNames = functionParameterNames(argsSchema, rootDoc);
      assertFunctionIdentifiers(name, paramNames);
      if (permittedNames && !permittedNames.has(name)) {
        continue;
      }
      if (!defn || typeof defn !== 'object') continue;
      result.push(
        new JsonFunctionApi(name, defn as Record<string, unknown>, definition => {
          const argsSchema = functionArgsSchema(definition);
          return argsSchema
            ? convertFunctionArgsJsonSchemaToZod(argsSchema, rootDoc, defCache)
            : z.record(z.unknown());
        }),
      );
    }
  }

  return result;
}

/**
 * Returns the schema of the arguments of a function a `functions` map
 * defines: its call schema's `args`, a bare map of argument schemas with the
 * object keywords beside it, or, for a definition that is not a call schema,
 * the definition itself.
 *
 * @param d The function's definition.
 */
function functionArgsSchema(
  d: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const props =
    d.properties &&
    typeof d.properties === 'object' &&
    d.properties !== null &&
    !Array.isArray(d.properties)
      ? (d.properties as Record<string, unknown>)
      : undefined;
  let argsSchema = props?.args ?? d.args ?? d.parameters;
  if (!argsSchema && props && !('call' in props) && !('@call' in props) && !('function' in props)) {
    argsSchema = d;
  } else if (isShorthandParameterMap(argsSchema)) {
    argsSchema = {
      type: 'object',
      properties: argsSchema as Record<string, unknown>,
      required: d.required,
      additionalProperties: d.additionalProperties,
    };
  }
  return argsSchema && typeof argsSchema === 'object' && !Array.isArray(argsSchema)
    ? (argsSchema as Record<string, unknown>)
    : undefined;
}

/**
 * Extracts permitted definition names matching a reference prefix from a `oneOf` array.
 *
 * @param oneOf Array of reference schema objects from `anyComponent` or `anyFunction`.
 * @param prefix Prefix to match and strip, such as `#/components/` or `#/functions/`.
 * @returns Set of unescaped allowed names, or undefined if `oneOf` is not an array.
 */
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
 * Parses raw catalog component schemas into typed ComponentApi definitions.
 *
 * Validates UAX #31 identifier requirements for v1.0+ specifications, filters
 * components if permitted names are specified, and transforms JSON schemas into
 * runtime Zod schemas.
 *
 * @param componentsMap Mapping of component name to raw component schema definition.
 * @param catalogSchema Enclosing raw catalog schema for resolving local references.
 * @param atLeastV10 Whether the catalog targets protocol v1.0 or higher.
 * @param permittedNames Optional set of allowed component names from anyComponent.oneOf.
 * @returns Array of parsed ComponentApi objects with validation schemas and hierarchy constraints.
 * @throws {A2uiCatalogError} If a component or property identifier fails UAX #31 validation in v1.0+.
 */
function parseCatalogComponents(
  componentsMap: Record<string, unknown>,
  catalogSchema: Record<string, unknown>,
  atLeastV10: boolean,
  permittedNames?: Set<string>,
): ComponentApi[] {
  const components: ComponentApi[] = [];
  const defCache = new Map<string, z.ZodTypeAny>();

  for (const [name, rawCompSchema] of Object.entries(componentsMap)) {
    const rawComp = (rawCompSchema as Record<string, unknown>) || {};
    if (atLeastV10) {
      assertUax31Identifier(name, `component identifier: '${name}'`);
      const props = rawComp.properties;
      if (props && typeof props === 'object') {
        for (const propName of Object.keys(props as Record<string, unknown>)) {
          assertUax31Identifier(
            propName,
            `property identifier: '${propName}' in component '${name}'`,
          );
        }
      }
    }
    if (permittedNames && !permittedNames.has(name)) {
      continue;
    }
    components.push(
      new JsonComponentApi(name, rawComp, definition =>
        convertComponentJsonSchemaToZod(
          definition as Record<string, unknown>,
          catalogSchema,
          true,
          defCache,
          atLeastV10,
        ),
      ),
    );
  }
  return components;
}

/**
 * Extracts and compiles the theme schema from a catalog definition if present.
 *
 * Checks top-level theme, themeSchema, styles, and $defs.theme definitions.
 *
 * @param catalogSchema Raw catalog schema or capabilities definition object.
 * @param defs Optional $defs mapping from the root schema.
 * @returns Compiled Zod object schema for theme tokens, or undefined if not declared.
 */
function parseThemeSchema(
  catalogSchema: Record<string, unknown>,
  defs?: Record<string, unknown>,
): z.ZodObject<z.ZodRawShape> | undefined {
  const rawTheme =
    catalogSchema.theme ??
    catalogSchema.themeSchema ??
    catalogSchema.styles ??
    (defs?.theme as Record<string, unknown> | undefined);
  if (rawTheme && typeof rawTheme === 'object') {
    const rawThemeObj = rawTheme as Record<string, unknown>;
    const normalizedThemeSchema =
      'properties' in rawThemeObj || 'allOf' in rawThemeObj || rawThemeObj.type === 'object'
        ? rawThemeObj
        : {type: 'object', properties: rawThemeObj};
    const themeZod = convertComponentJsonSchemaToZod(normalizedThemeSchema, catalogSchema, false);
    // Unlike a component, a theme is open unless its author closes it, as JSON
    // Schema itself defaults.
    const closed =
      normalizedThemeSchema.additionalProperties === false ||
      normalizedThemeSchema.unevaluatedProperties === false;
    return closed ? themeZod : themeZod.passthrough();
  }
  return undefined;
}

/**
 * Parses a raw A2UI catalog schema into its typed component, function, and metadata fields.
 *
 * Parses component and function definitions, extracts hierarchy constraints (`allowedParents`,
 * `allowedChildren`), unescapes RFC 6901 JSON pointers, and builds runtime Zod validators.
 *
 * @param inputSchema Raw catalog schema or capabilities definition object. It
 *   is copied first and never referenced afterwards.
 * @param protocolVersion Protocol version of the catalog. When given, it takes
 *   precedence over the `protocolVersion` the schema declares and selects the
 *   version's loading rules; the declared version is still kept as written.
 *   Catalog schemas published before v1.0 omit `protocolVersion`; when
 *   neither the caller nor the schema supplies it, `DEFAULT_PROTOCOL_VERSION`
 *   applies.
 * @param catalogIdOverride Catalog ID to use instead of the one the schema
 *   declares. The schema itself is kept as written.
 * @returns Parsed catalog fields ready to construct a `Catalog` instance.
 * @throws {Error} If the catalog ID is missing or not a string.
 */
export function parseCatalogSchema(
  inputSchema: Record<string, unknown>,
  protocolVersion?: string,
  catalogIdOverride?: string,
): ParsedCatalogSchema {
  // Everything the catalog keeps, including what the Zod schemas close over,
  // comes from this copy, so mutating the input afterwards cannot change it.
  const catalogSchema = deepCopyJson(inputSchema);
  const catalogId =
    catalogIdOverride ?? catalogSchema.catalogId ?? catalogSchema.$id ?? catalogSchema.id;
  if (!catalogId || typeof catalogId !== 'string') {
    throw new Error("Catalog ID must be specified via catalog metadata ('catalogId' or '$id').");
  }

  // Filter permitted components via anyComponent.oneOf if declared
  const defs = catalogSchema.$defs as Record<string, unknown> | undefined;
  const anyComp = defs?.anyComponent as Record<string, unknown> | undefined;
  const permittedNames = extractPermittedNames(anyComp?.oneOf, '#/components/');

  const resolvedVersion =
    protocolVersion ??
    (catalogSchema.protocolVersion as string | undefined) ??
    DEFAULT_PROTOCOL_VERSION;
  const atLeastV10 = isAtLeastVersion(resolvedVersion, '1.0');

  const componentsMap = (catalogSchema.components as Record<string, unknown>) ?? {};
  const components = parseCatalogComponents(
    componentsMap,
    catalogSchema,
    atLeastV10,
    permittedNames,
  );

  // Filter permitted functions via anyFunction.oneOf if declared
  const anyFunc = defs?.anyFunction as Record<string, unknown> | undefined;
  const permittedFunctionNames = extractPermittedNames(anyFunc?.oneOf, '#/functions/');

  const functions = parseFunctionDefinitions(
    catalogSchema.functions,
    catalogSchema,
    permittedFunctionNames,
    atLeastV10,
  );

  const themeSchema = parseThemeSchema(catalogSchema, defs);

  // The copy is frozen: the entries' definitions and the document fields
  // refer into it.
  deepFreeze(catalogSchema);

  return {
    id: catalogId,
    protocolVersion: resolvedVersion,
    components,
    functions,
    themeSchema,
    ...readDocumentFields(catalogSchema, components, functions),
  };
}

/** Top-level keys of a catalog document that `CatalogDocumentOptions` models. */
const DOCUMENT_STRING_FIELDS = {
  '$schema': 'schemaUri',
  '$id': 'schemaId',
  'title': 'title',
  'description': 'description',
  'instructions': 'instructions',
} as const;

/** Top-level keys of a catalog document that `Catalog` models besides the string fields. */
const DOCUMENT_STRUCTURE_FIELDS = new Set(['protocolVersion', 'catalogId', 'components']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether `actual` is the union a catalog computes, ignoring object key order.
 */
function isComputedUnion(actual: unknown, computed: Record<string, unknown>): boolean {
  return canonicalJsonStringify(actual) === canonicalJsonStringify(computed);
}

/**
 * Reads the document-level fields of a catalog document into the model fields
 * `Catalog` keeps.
 *
 * The `anyComponent` and `anyFunction` unions become flags when they list
 * exactly the loaded entries, in order, as `toJson` computes them; a union of
 * any other form stays in `defs` as written. Keys the model has no field for
 * are kept in `extensionFields`.
 *
 * @param document The frozen catalog document.
 * @param components The components loaded from it.
 * @param functions The functions loaded from it.
 */
function readDocumentFields(
  document: Readonly<Record<string, unknown>>,
  components: readonly ComponentApi[],
  functions: readonly FunctionApi[],
): CatalogDocumentOptions {
  const fields: CatalogDocumentOptions = {};
  const extensionFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key in DOCUMENT_STRING_FIELDS && typeof value === 'string') {
      fields[DOCUMENT_STRING_FIELDS[key as keyof typeof DOCUMENT_STRING_FIELDS]] = value;
    } else if (key === 'protocolVersion' && typeof value === 'string') {
      fields.declaredProtocolVersion = value;
    } else if (key === 'functions' && (Array.isArray(value) || isPlainObject(value))) {
      fields.functionsLayout = Array.isArray(value) ? 'list' : 'map';
    } else if (key === '$defs' && isPlainObject(value)) {
      const anyComponent = isComputedUnion(
        value['anyComponent'],
        buildComponentUnion(components.map(c => c.name)),
      );
      const anyFunction = isComputedUnion(
        value['anyFunction'],
        buildFunctionUnion(functions.map(f => f.name)),
      );
      fields.unions = {anyComponent, anyFunction};
      const defs: Record<string, unknown> = {};
      for (const [name, def] of Object.entries(value)) {
        if ((name === 'anyComponent' && anyComponent) || (name === 'anyFunction' && anyFunction)) {
          continue;
        }
        defs[name] = def;
      }
      fields.defs = Object.freeze(defs);
    } else if (
      !DOCUMENT_STRUCTURE_FIELDS.has(key) ||
      (key === 'components' && !isPlainObject(value))
    ) {
      extensionFields[key] = value;
    }
  }
  fields.declaredProtocolVersion ??= null;
  fields.declaresCatalogId = typeof document['catalogId'] === 'string';
  fields.declaresComponents = isPlainObject(document['components']);
  fields.unions ??= {anyComponent: false, anyFunction: false};
  if (Object.keys(extensionFields).length > 0) {
    fields.extensionFields = Object.freeze(extensionFields);
  }
  return fields;
}
