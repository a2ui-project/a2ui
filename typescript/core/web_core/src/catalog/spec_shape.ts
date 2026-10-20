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

/**
 * @fileoverview Specification-shaped catalog definitions of Zod models.
 *
 * A component of a catalog defined in code is a Zod object of all of its
 * properties, annotated (see `spec_annotations.ts`) with the mixins its
 * definition composes with `allOf` and anything else the catalog document
 * writes that Zod does not express. A function's model is the Zod object of
 * its arguments. This module turns such models back into the definitions a
 * catalog document writes. The layout rules depend only on the protocol
 * version, not on the catalog.
 *
 * This module is internal to web_core and is not re-exported by any facade.
 */

import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';

import {isAtLeastVersion, normalizeVersionString, toCanonicalVersion} from '../common/semver.js';
import {V08_STANDARD_DEFS} from '../v0_8/standard_defs.js';
import {V09_STANDARD_DEFS} from '../v0_9/standard_defs.js';
import {V10_STANDARD_DEFS} from '../v1_0/standard_defs.js';
import {getSpecAnnotation, type SpecAnnotation, type SpecMixin} from './spec_annotations.js';

type JsonObject = Record<string, unknown>;

/** The reference a common types document is written as when a catalog names none. */
export const DEFAULT_COMMON_TYPES_URI = 'common_types.json';

const STANDARD_DEFS_BY_VERSION: Readonly<Record<string, Record<string, unknown>>> = {
  '0.8': V08_STANDARD_DEFS,
  '0.9': V09_STANDARD_DEFS,
  '0.9.1': V09_STANDARD_DEFS,
  '1.0': V10_STANDARD_DEFS,
};

/**
 * Returns the common types definitions of a protocol version. A version with
 * no entry of its own at or above 1.0 gets the v1.0 definitions, and any other
 * version the v0.9 definitions.
 *
 * @param version A protocol version.
 */
export function standardDefsForVersion(version: string | undefined): Record<string, unknown> {
  if (version) {
    const key = toCanonicalVersion(version) ?? normalizeVersionString(version);
    if (key in STANDARD_DEFS_BY_VERSION) return STANDARD_DEFS_BY_VERSION[key];
    if (isAtLeastVersion(version, '1.0')) return V10_STANDARD_DEFS;
  }
  return V09_STANDARD_DEFS;
}

function copyJson<V>(value: V): V {
  return JSON.parse(JSON.stringify(value)) as V;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The Zod definition fields the shaper reads. */
interface ZodDefLike {
  readonly typeName?: string;
  readonly description?: string;
  readonly [key: string]: unknown;
}

function defOf(schema: z.ZodTypeAny): ZodDefLike {
  return schema._def as ZodDefLike;
}

/** The properties of a component that the message envelope declares. */
const ENVELOPE_PROPERTIES = new Set(['id', 'component']);

/**
 * Returns whether a component's schema is a specification-shaped model: one
 * annotated with the mixins its definition composes.
 */
export function isSpecComponentSchema(schema: unknown): boolean {
  return collectAnnotation(schema as z.ZodTypeAny).mixins !== undefined;
}

/**
 * Returns whether a function's argument schema is a specification-shaped
 * model: one with an annotation.
 */
export function isSpecFunctionSchema(schema: unknown): boolean {
  return Object.keys(collectAnnotation(schema as z.ZodTypeAny)).length > 0;
}

/**
 * Returns the annotations of a schema and of the wrappers around its core
 * (`optional`, `default`, refinements), the outer ones winning.
 */
function collectAnnotation(schema: z.ZodTypeAny | undefined): SpecAnnotation {
  const chain: SpecAnnotation[] = [];
  let node: z.ZodTypeAny | undefined = schema;
  while (node && typeof node === 'object' && '_def' in node) {
    const annotation = getSpecAnnotation(node);
    if (annotation) chain.push(annotation);
    const next = innerSchema(node);
    if (!next) break;
    node = next;
  }
  return chain.reduceRight<SpecAnnotation>((merged, a) => ({...merged, ...a}), {});
}

/** Returns the schema a wrapper (`optional`, `default`, ...) wraps. */
function innerSchema(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const def = defOf(schema);
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      return def['innerType'] as z.ZodTypeAny;
    case 'ZodEffects':
      return def['schema'] as z.ZodTypeAny;
    case 'ZodBranded':
      return def['type'] as z.ZodTypeAny;
    default:
      return undefined;
  }
}

/** A definition and the catalog definitions it needs. */
export interface SpecSchema {
  /** The definition. */
  readonly schema: JsonObject;
  /**
   * The models of the catalog definitions the definition references, by
   * name, such as a component's `CatalogComponentCommon` mixin.
   */
  readonly catalogDefs: ReadonlyMap<string, z.ZodTypeAny>;
}

/**
 * Builds specification-shaped definitions of Zod models for a protocol
 * version.
 */
export class SpecShaper {
  private readonly isV08: boolean;
  private readonly isV10: boolean;
  private readonly standardDefs: Record<string, unknown>;

  /**
   * @param protocolVersion The catalog's protocol version.
   * @param commonTypesUri How the catalog's document writes the common types
   *     document in references, such as `common_types.json`.
   */
  constructor(
    protocolVersion: string,
    private readonly commonTypesUri: string = DEFAULT_COMMON_TYPES_URI,
  ) {
    this.isV08 = !isAtLeastVersion(protocolVersion, '0.9');
    this.isV10 = isAtLeastVersion(protocolVersion, '1.0');
    this.standardDefs = standardDefsForVersion(protocolVersion);
  }

  /**
   * Returns the definition a catalog document writes for a component.
   *
   * @param name The component's name.
   * @param schema The component's schema, annotated with its mixins.
   * @param allowedParents The component's allowed parents, if restricted.
   * @param allowedChildren The component's allowed children, if restricted.
   */
  componentSchema(
    name: string,
    schema: z.ZodTypeAny,
    allowedParents?: readonly string[],
    allowedChildren?: readonly string[],
  ): SpecSchema {
    const catalogDefs = new Map<string, z.ZodTypeAny>();
    let result: JsonObject;
    if (this.isV08) {
      // A v0.8 catalog document has no common types: the whole component is
      // written inline, without the properties the envelope declares.
      result = this.toJson(schema);
      const properties = result['properties'];
      if (isObject(properties)) {
        for (const key of ENVELOPE_PROPERTIES) delete properties[key];
      }
      if (Array.isArray(result['required'])) {
        const required = result['required'].filter(r => !ENVELOPE_PROPERTIES.has(r as string));
        if (required.length > 0) result['required'] = required;
        else delete result['required'];
      }
    } else {
      const annotation = collectAnnotation(schema);
      const mixins = annotation.mixins ?? [];
      const inherited = new Set<string>(ENVELOPE_PROPERTIES);
      const refs: JsonObject[] = [];
      for (const mixin of mixins) {
        refs.push({$ref: this.mixinRef(mixin, catalogDefs)});
        for (const key of this.mixinProperties(mixin)) inherited.add(key);
      }
      const object = coreSchema(schema);
      const description = plainDescription(schema);
      const own = this.objectSchema(object, annotation, key => !inherited.has(key));
      const properties = {component: {const: name}, ...(own['properties'] as JsonObject)};
      const required = ['component', ...((own['required'] as string[] | undefined) ?? [])];
      const inner: JsonObject = {type: 'object'};
      // The specification puts a v1.0 description on the component and a
      // v0.9 description on the object of its own properties.
      if (description !== undefined && !this.isV10) inner['description'] = description;
      inner['properties'] = properties;
      inner['required'] = required;
      result = {type: 'object'};
      if (this.isV10) {
        if (description !== undefined) result['description'] = description;
        if (refs.length > 0) {
          result['allOf'] = [...refs, inner];
        } else {
          result['properties'] = properties;
          result['required'] = required;
        }
      } else {
        result['allOf'] = [...refs, inner];
        result['unevaluatedProperties'] = false;
      }
    }
    if (allowedParents && allowedParents.length > 0) result['allowedParents'] = [...allowedParents];
    if (allowedChildren && allowedChildren.length > 0) {
      result['allowedChildren'] = [...allowedChildren];
    }
    return {schema: result, catalogDefs};
  }

  /**
   * Returns the definition a catalog document writes for a function: the
   * schema of a call to it.
   *
   * @param name The function's name.
   * @param fn The function's API, whose `schema` is its argument model.
   */
  functionSchema(
    name: string,
    fn: {
      readonly schema: z.ZodTypeAny;
      readonly returnType: string;
      readonly description?: string;
      readonly allowedCallers?: string;
      readonly requiresUserActivation?: boolean;
    },
  ): JsonObject {
    const args = this.toJson(fn.schema);
    const argsRequired = Array.isArray(args['required']) && args['required'].length > 0;
    const result: JsonObject = {type: 'object'};
    if (fn.description) result['description'] = fn.description;
    if (this.isV10) {
      result['returnType'] = fn.returnType;
      if (fn.allowedCallers) result['allowedCallers'] = fn.allowedCallers;
      if (fn.requiresUserActivation) result['requiresUserActivation'] = true;
      result['properties'] = {'@call': {const: name}, args};
      result['required'] = argsRequired ? ['@call', 'args'] : ['@call'];
      return result;
    }
    if (fn.allowedCallers) result['allowedCallers'] = fn.allowedCallers;
    if (fn.requiresUserActivation) result['requiresUserActivation'] = true;
    result['properties'] = {call: {const: name}, args, returnType: {const: fn.returnType}};
    result['required'] = argsRequired ? ['call', 'args'] : ['call'];
    result['unevaluatedProperties'] = false;
    return result;
  }

  /**
   * Returns the definition a catalog document writes for a model, such as a
   * mixin or a theme.
   *
   * @param schema The model.
   */
  defSchema(schema: z.ZodTypeAny): JsonObject {
    return this.toJson(schema);
  }

  /** Returns the reference a component's definition makes to a mixin. */
  private mixinRef(mixin: SpecMixin, catalogDefs: Map<string, z.ZodTypeAny>): string {
    if (typeof mixin === 'string') return `${this.commonTypesUri}#/$defs/${mixin}`;
    const name = collectAnnotation(mixin).defName;
    if (name === undefined) {
      throw new Error('A component mixin model must be named with specDef().');
    }
    catalogDefs.set(name, mixin);
    return `#/$defs/${name}`;
  }

  /** Returns the names of the properties a mixin declares. */
  private mixinProperties(mixin: SpecMixin): string[] {
    if (typeof mixin !== 'string') {
      const core = coreSchema(mixin);
      return defOf(core).typeName === 'ZodObject'
        ? Object.keys((core as z.AnyZodObject).shape)
        : [];
    }
    const names: string[] = [];
    const collect = (def: unknown, seen: Set<unknown>): void => {
      if (!isObject(def) || seen.has(def)) return;
      seen.add(def);
      if (isObject(def['properties'])) names.push(...Object.keys(def['properties']));
      for (const sub of Array.isArray(def['allOf']) ? def['allOf'] : []) {
        const ref = isObject(sub) ? sub['$ref'] : undefined;
        const target =
          typeof ref === 'string' && ref.startsWith('#/$defs/')
            ? this.standardDefs[ref.substring('#/$defs/'.length)]
            : sub;
        collect(target, seen);
      }
    };
    collect(this.standardDefs[mixin], new Set());
    return names;
  }

  /**
   * Returns the JSON Schema a catalog document writes for a Zod schema.
   *
   * @param schema The schema.
   */
  toJson(schema: z.ZodTypeAny): JsonObject {
    const annotation = collectAnnotation(schema);
    const description = schemaDescription(schema);
    const defaultValue = schemaDefault(schema);
    let core: JsonObject;
    let ownDescription = description;
    if (description !== undefined && description.startsWith('REF:')) {
      const content = description.substring(4);
      const pipe = content.indexOf('|');
      const ref = pipe === -1 ? content : content.substring(0, pipe);
      ownDescription = pipe === -1 ? undefined : content.substring(pipe + 1);
      core = {$ref: this.refTarget(ref)};
    } else {
      core = this.coreJson(coreSchema(schema), annotation);
    }
    if (annotation.keywords) Object.assign(core, copyJson(annotation.keywords));
    const result: JsonObject = annotation.allOf
      ? {allOf: [core, ...annotation.allOf.map(s => copyJson(s))]}
      : core;
    if (ownDescription) result['description'] = ownDescription;
    if (defaultValue !== undefined) result['default'] = defaultValue;
    return result;
  }

  /** Writes a `REF:` marker's reference as the catalog document does. */
  private refTarget(ref: string): string {
    if (!ref.startsWith('#/$defs/')) return ref;
    return `${this.commonTypesUri}${ref}`;
  }

  /** Converts the core of a schema, below its wrappers. */
  private coreJson(schema: z.ZodTypeAny, annotation: SpecAnnotation): JsonObject {
    const def = defOf(schema);
    switch (def.typeName) {
      case 'ZodObject':
        return this.objectSchema(schema as z.AnyZodObject, annotation, () => true);
      case 'ZodString':
        return stringSchema(def);
      case 'ZodNumber':
        return numberSchema(def);
      case 'ZodBoolean':
        return {type: 'boolean'};
      case 'ZodNull':
        return {type: 'null'};
      case 'ZodEnum':
        return {type: 'string', enum: [...(def['values'] as unknown[])]};
      case 'ZodLiteral':
        return {const: def['value']};
      case 'ZodAny':
      case 'ZodUnknown':
        return {};
      case 'ZodNever':
        return {not: {}};
      case 'ZodArray': {
        const result: JsonObject = {
          type: 'array',
          items: this.toJson(def['type'] as z.ZodTypeAny),
        };
        const min = def['minLength'] as {value: number} | null;
        const max = def['maxLength'] as {value: number} | null;
        if (min) result['minItems'] = min.value;
        if (max) result['maxItems'] = max.value;
        return result;
      }
      case 'ZodUnion':
      case 'ZodDiscriminatedUnion': {
        const options = def['options'] as Iterable<z.ZodTypeAny>;
        return {oneOf: [...options].map(option => this.toJson(option))};
      }
      case 'ZodRecord':
        return {
          type: 'object',
          additionalProperties: this.toJson(def['valueType'] as z.ZodTypeAny),
        };
      case 'ZodLazy':
        return this.toJson((def['getter'] as () => z.ZodTypeAny)());
      default:
        return fallbackJson(schema);
    }
  }

  /**
   * Converts an object schema, keeping the properties `keep` accepts. Its
   * `required` list follows the annotation, or else the property order.
   */
  private objectSchema(
    schema: z.ZodTypeAny,
    annotation: SpecAnnotation,
    keep: (key: string) => boolean,
  ): JsonObject {
    const def = defOf(schema);
    if (def.typeName !== 'ZodObject') return this.toJson(schema);
    const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const properties: JsonObject = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      if (!keep(key)) continue;
      properties[key] = this.toJson(value);
      if (!value.isOptional()) required.push(key);
    }
    const result: JsonObject = {type: 'object', properties};
    const order = annotation.required?.filter(key => required.includes(key));
    const unordered = required.filter(key => !order?.includes(key));
    if (required.length > 0) result['required'] = order ? [...order, ...unordered] : required;
    const unknownKeys = def['unknownKeys'];
    const catchall = def['catchall'] as z.ZodTypeAny | undefined;
    const keyword =
      annotation.closure ?? (unknownKeys === 'strict' ? 'additionalProperties' : 'none');
    if (catchall && defOf(catchall).typeName !== 'ZodNever') {
      result[keyword === 'none' ? 'additionalProperties' : keyword] = this.toJson(catchall);
    } else if (keyword !== 'none') {
      result[keyword] = unknownKeys === 'passthrough';
    }
    return result;
  }
}

/** Returns the core of a schema, below its wrappers. */
function coreSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let node = schema;
  for (let next = innerSchema(node); next; next = innerSchema(node)) node = next;
  return node;
}

/** Returns the description of a schema's outermost node that has one. */
function schemaDescription(schema: z.ZodTypeAny): string | undefined {
  for (let node: z.ZodTypeAny | undefined = schema; node; node = innerSchema(node)) {
    const description = defOf(node).description;
    if (typeof description === 'string') return description;
  }
  return undefined;
}

/** Returns a schema's description, unless it is a `REF:` marker. */
function plainDescription(schema: z.ZodTypeAny): string | undefined {
  const description = schemaDescription(schema);
  return description !== undefined && !description.startsWith('REF:') ? description : undefined;
}

/** Returns the default value of a schema's outermost `default` wrapper. */
function schemaDefault(schema: z.ZodTypeAny): unknown {
  for (let node: z.ZodTypeAny | undefined = schema; node; node = innerSchema(node)) {
    const def = defOf(node);
    if (def.typeName === 'ZodDefault') return (def['defaultValue'] as () => unknown)();
  }
  return undefined;
}

/** Formats that a Zod string check stands for. */
const STRING_FORMATS: Readonly<Record<string, string>> = {
  email: 'email',
  url: 'uri',
  uuid: 'uuid',
  datetime: 'date-time',
  date: 'date',
  time: 'time',
};

function stringSchema(def: ZodDefLike): JsonObject {
  const result: JsonObject = {type: 'string'};
  for (const check of (def['checks'] as Array<{kind: string; [key: string]: unknown}>) ?? []) {
    if (check.kind === 'regex') result['pattern'] = (check['regex'] as RegExp).source;
    else if (check.kind === 'min') result['minLength'] = check['value'];
    else if (check.kind === 'max') result['maxLength'] = check['value'];
    else if (check.kind in STRING_FORMATS) result['format'] = STRING_FORMATS[check.kind];
  }
  return result;
}

function numberSchema(def: ZodDefLike): JsonObject {
  const checks = (def['checks'] as Array<{kind: string; [key: string]: unknown}>) ?? [];
  const result: JsonObject = {
    type: checks.some(check => check.kind === 'int') ? 'integer' : 'number',
  };
  for (const check of checks) {
    if (check.kind === 'min') {
      result[check['inclusive'] ? 'minimum' : 'exclusiveMinimum'] = check['value'];
    } else if (check.kind === 'max') {
      result[check['inclusive'] ? 'maximum' : 'exclusiveMaximum'] = check['value'];
    }
  }
  return result;
}

/** Converts a schema the shaper has no rule for with `zod-to-json-schema`. */
function fallbackJson(schema: z.ZodTypeAny): JsonObject {
  const json = zodToJsonSchema(schema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as JsonObject;
  delete json['$schema'];
  delete json['definitions'];
  delete json['$defs'];
  return json;
}
