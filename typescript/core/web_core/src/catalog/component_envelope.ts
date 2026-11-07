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
 * Component envelope mixins: the protocol fields a component object carries
 * beside its own properties (`ComponentCommon` and `Checkable`).
 *
 * From v1.0 these are written with an `@` prefix (`@metadata`, `@catalogId`,
 * `@accessibility`, `@checks`), which leaves the bare names free for a
 * catalog's own component properties. During the transition a v1.0 component
 * may still carry a legacy bare `metadata`, `catalogId`, `accessibility`, or
 * `checks` mixin, as long as its schema does not declare a custom property of
 * that name. Below v1.0 the bare `accessibility` and `checks` are the mixins,
 * and `metadata` and `catalogId` are ordinary component properties.
 */

import {z} from 'zod';
import {A2uiValidationError} from '../errors.js';
import {isAtLeastVersion} from '../common/semver.js';
import {getSpecAnnotation} from './spec_annotations.js';
import * as CommonTypes from '../types/common-types.js';
import * as V09CommonTypes from '../v0_9/schema/common-types.js';
import * as V10CommonTypes from '../v1_0/schema/common-types.js';

/** The bare names of the component envelope mixins. */
export const COMPONENT_MIXIN_KEYS = ['metadata', 'catalogId', 'accessibility', 'checks'] as const;

/** The bare name of a component envelope mixin. */
export type ComponentMixinKey = (typeof COMPONENT_MIXIN_KEYS)[number];

/** The v1.0 wire key of a component envelope mixin, such as `@metadata`. */
export type AtComponentMixinKey = `@${ComponentMixinKey}`;

/**
 * The v1.0 wire keys of the component envelope mixins, which are allowed as
 * single-`@` keys at the root of a component object and nowhere else.
 */
export const AT_COMPONENT_MIXIN_KEYS: ReadonlySet<string> = new Set(
  COMPONENT_MIXIN_KEYS.map(atMixinKey),
);

/**
 * Returns the v1.0 wire key of a component envelope mixin.
 *
 * @param key The mixin's bare name.
 * @returns The `@`-prefixed key.
 */
export function atMixinKey(key: ComponentMixinKey): AtComponentMixinKey {
  return `@${key}`;
}

/** Schemas that describe a standard mixin property rather than a custom one. */
const standardMixinSchemas = new WeakSet<object>();

/**
 * Marks a Zod schema as the standard `ComponentCommon` or `Checkable` schema
 * of a mixin property, so that a component declaring a property with this
 * schema is not taken to declare a custom property of the same name.
 *
 * @param schema The mixin property's schema.
 * @returns `schema`, for chaining.
 */
export function markStandardMixinSchema<T extends z.ZodTypeAny>(schema: T): T {
  standardMixinSchemas.add(schema);
  return schema;
}

for (const types of [CommonTypes, V09CommonTypes, V10CommonTypes]) {
  for (const [key, prop] of Object.entries(types.ComponentCommonSchema.shape)) {
    if (key !== 'id') markStandardMixinSchema(prop as z.ZodTypeAny);
  }
  markStandardMixinSchema(types.CheckableSchema.shape.checks);
  markStandardMixinSchema(types.CheckRuleSchema);
  markStandardMixinSchema(types.AccessibilityAttributesSchema);
}

/**
 * How a component's schema declares the envelope mixins.
 */
export interface ComponentMixinLayout {
  /**
   * Bare mixin names the component's schema declares as its own custom
   * properties. On v1.0 such a bare key is a component property, and only
   * its `@`-prefixed form is the mixin.
   */
  readonly customKeys: ReadonlySet<ComponentMixinKey>;
  /**
   * For each mixin the component's schema declares with its standard
   * schema, the schema key that holds it (`checks` or `@checks`, say).
   */
  readonly schemaKeys: ReadonlyMap<ComponentMixinKey, string>;
}

const EMPTY_LAYOUT: ComponentMixinLayout = {customKeys: new Set(), schemaKeys: new Map()};
const layoutCache = new WeakMap<object, ComponentMixinLayout>();

const INNER_TYPE_WRAPPERS = new Set([
  'ZodOptional',
  'ZodNullable',
  'ZodDefault',
  'ZodCatch',
  'ZodReadonly',
]);

/** Returns the inner schema wrapped by a single Zod wrapper node, if any. */
function unwrapSchemaLayer(def: any): any {
  const typeName = def?.typeName;
  if (typeName === 'ZodEffects') return def.schema;
  if (INNER_TYPE_WRAPPERS.has(typeName)) return def.innerType;
  if (typeName === 'ZodBranded') return def.type;
  if (typeName === 'ZodLazy') return def.getter();
  return undefined;
}

/**
 * Unwraps Zod wrappers to reach a component schema's object shape.
 *
 * @param schema A component schema.
 * @returns The merged object shape, or `undefined` if the schema has none.
 */
function objectShapeOf(schema: z.ZodTypeAny | undefined): Record<string, z.ZodTypeAny> | undefined {
  let current: any = schema;
  while (current) {
    const def = current._def;
    if (def?.typeName === 'ZodObject') {
      return typeof current.shape === 'function' ? current.shape() : current.shape;
    }
    if (def?.typeName === 'ZodIntersection') {
      const left = objectShapeOf(def.left);
      const right = objectShapeOf(def.right);
      return left || right ? {...left, ...right} : undefined;
    }
    current = unwrapSchemaLayer(def);
  }
  return undefined;
}

/** Unwraps optional, nullable, default, and effect wrappers of a property schema. */
function unwrapProperty(schema: z.ZodTypeAny): any {
  let current: any = schema;
  while (current && !standardMixinSchemas.has(current)) {
    const inner = unwrapSchemaLayer(current._def);
    if (!inner) break;
    current = inner;
  }
  return current;
}

/** The definition name a schema's `REF:` description points at, if any. */
function refDefName(schema: any): string | undefined {
  const description: unknown = schema?.description;
  if (typeof description !== 'string' || !description.startsWith('REF:')) return undefined;
  const ref = description.slice(4).split('|')[0];
  return ref.split('/').pop();
}

/**
 * Whether a property schema a component declares under a mixin's bare name
 * is the standard mixin schema rather than a custom property.
 */
function isStandardMixinProperty(
  componentSchema: z.ZodTypeAny,
  key: ComponentMixinKey,
  prop: z.ZodTypeAny,
): boolean {
  const inner = unwrapProperty(prop);
  if (standardMixinSchemas.has(prop) || standardMixinSchemas.has(inner)) return true;
  const mixins = getSpecAnnotation(componentSchema)?.mixins ?? [];
  switch (key) {
    case 'checks': {
      if (mixins.includes('Checkable')) return true;
      if (inner?._def?.typeName !== 'ZodArray') return false;
      const element = unwrapProperty(inner._def.type);
      return standardMixinSchemas.has(element) || refDefName(element) === 'CheckRule';
    }
    case 'accessibility':
      return refDefName(inner) === 'AccessibilityAttributes';
    default:
      return false;
  }
}

/**
 * Describes how a component's schema declares the envelope mixins: which bare
 * mixin names it declares as custom properties, and under which keys it
 * declares the standard mixins.
 *
 * @param schema The component's schema, if known.
 * @returns The component's mixin layout.
 */
export function componentMixinLayout(schema: z.ZodTypeAny | undefined): ComponentMixinLayout {
  if (!schema) return EMPTY_LAYOUT;
  const cached = layoutCache.get(schema);
  if (cached) return cached;
  const shape = objectShapeOf(schema) ?? {};
  const customKeys = new Set<ComponentMixinKey>();
  const schemaKeys = new Map<ComponentMixinKey, string>();
  for (const key of COMPONENT_MIXIN_KEYS) {
    const atKey = atMixinKey(key);
    const bare = Object.hasOwn(shape, key) ? shape[key] : undefined;
    if (Object.hasOwn(shape, atKey)) {
      schemaKeys.set(key, atKey);
      if (bare) customKeys.add(key);
    } else if (bare) {
      if (isStandardMixinProperty(schema, key, bare)) {
        schemaKeys.set(key, key);
      } else {
        customKeys.add(key);
      }
    }
  }
  const layout = {customKeys, schemaKeys};
  layoutCache.set(schema, layout);
  return layout;
}

/**
 * Adjusts a v1.0 component's mixin layout so that a legacy bare `catalogId`
 * routing the component is not also kept as one of its properties.
 *
 * Whether a bare `catalogId` names the component's catalog is decided by the
 * component's schema in the surface's default catalog, because the catalog
 * it names is not known until then. When that schema declares no custom
 * `catalogId`, the bare key routes the component, so it is the mixin even if
 * the schema in the catalog it routes to declares a `catalogId` of its own.
 *
 * @param layout The component's layout in the catalog it resolved to.
 * @param comp The raw component object.
 * @param defaultCatalogSchema The component's schema in the surface's
 *   default catalog, if that catalog defines its type.
 * @returns `layout`, or a copy that treats the bare `catalogId` as the mixin.
 */
export function routeLegacyCatalogId(
  layout: ComponentMixinLayout,
  comp: Readonly<Record<string, unknown>>,
  defaultCatalogSchema: z.ZodTypeAny | undefined,
): ComponentMixinLayout {
  if (
    !layout.customKeys.has('catalogId') ||
    comp[atMixinKey('catalogId')] !== undefined ||
    comp['catalogId'] === undefined ||
    componentMixinLayout(defaultCatalogSchema).customKeys.has('catalogId')
  ) {
    return layout;
  }
  const customKeys = new Set(layout.customKeys);
  customKeys.delete('catalogId');
  return {customKeys, schemaKeys: layout.schemaKeys};
}

/** A component envelope mixin read from a v1.0 component object. */
export interface ComponentMixinValue {
  /** The mixin's value. */
  readonly value: unknown;
  /** The wire key it was read from: `@metadata`, or legacy `metadata`. */
  readonly wireKey: string;
}

/** A v1.0 component object split into its envelope and its properties. */
export interface SplitComponent {
  /**
   * The component's own properties: everything but `id`, `component`, and
   * the envelope mixins.
   */
  readonly properties: Record<string, unknown>;
  /** The envelope mixins the component object carries. */
  readonly mixins: Partial<Record<ComponentMixinKey, ComponentMixinValue>>;
}

/**
 * Splits a v1.0 component object into its envelope mixins and its own
 * properties.
 *
 * A mixin is read from its `@`-prefixed key, or else from its legacy bare
 * key when the component's schema declares no custom property of that name.
 * A legacy bare `checks` is a mixin only on a checkable component; on any
 * other component it stays a property, which the component's schema rejects.
 *
 * @param comp The raw component object.
 * @param layout The component's mixin layout.
 * @returns The component's properties and envelope mixins.
 * @throws {A2uiValidationError} If the component object carries both the
 *   `@`-prefixed and the legacy bare key of a mixin its schema declares no
 *   custom property for.
 */
export function splitComponentEnvelope(
  comp: Readonly<Record<string, unknown>>,
  layout: ComponentMixinLayout,
): SplitComponent {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(comp)) {
    if (key === 'id' || key === 'component' || AT_COMPONENT_MIXIN_KEYS.has(key)) continue;
    properties[key] = value;
  }
  const mixins: Partial<Record<ComponentMixinKey, ComponentMixinValue>> = {};
  for (const key of COMPONENT_MIXIN_KEYS) {
    const atKey = atMixinKey(key);
    const hasAt = comp[atKey] !== undefined;
    const hasBare = comp[key] !== undefined;
    const custom = layout.customKeys.has(key);
    if (hasAt && hasBare && !custom) {
      const msg = `Component '${String(comp['id'])}' cannot specify both '${atKey}' and legacy '${key}'.`;
      throw new A2uiValidationError(
        msg,
        [{path: `/${key}`, code: 'invalid_value', message: msg}],
        'VALIDATION_ERROR',
        {path: `/${key}`},
      );
    }
    if (hasAt) {
      mixins[key] = {value: comp[atKey], wireKey: atKey};
    } else if (hasBare && !custom && (key !== 'checks' || layout.schemaKeys.has('checks'))) {
      mixins[key] = {value: comp[key], wireKey: key};
      delete properties[key];
    }
  }
  return {properties, mixins};
}

/** The state a component object stores in its `ComponentModel`. */
export interface ComponentPayloadState {
  /** The component's properties, as `ComponentModel.properties` holds them. */
  readonly properties: Record<string, unknown>;
  /** The component's envelope metadata, if any. */
  readonly metadata: unknown;
}

/**
 * Reads the state a component object stores in its `ComponentModel`.
 *
 * Below v1.0 every key but `id` and `component` is a property, including a
 * `metadata` or `catalogId` the component declares, and the component has no
 * envelope metadata.
 *
 * From v1.0 the envelope mixins are split from the component's properties
 * (see {@link splitComponentEnvelope}): `@metadata` becomes the component's
 * metadata, `@catalogId` selects its catalog and is not stored, and
 * `@accessibility` and `@checks` are stored under their `@`-prefixed keys,
 * leaving the bare names to the component's own properties.
 *
 * @param comp The raw component object.
 * @param protocolVersion The protocol version of the surface.
 * @param schema The component's schema, if known.
 * @param options.defaultCatalogSchema The component's schema in the surface's
 *   default catalog, when the caller resolved the component's catalog; a
 *   legacy bare `catalogId` that routed the component is then dropped from its
 *   properties (see {@link routeLegacyCatalogId}).
 * @returns The component's properties and metadata.
 * @throws {A2uiValidationError} If a v1.0 component object carries both forms
 *   of a mixin; see {@link splitComponentEnvelope}.
 */
export function componentPayloadState(
  comp: Readonly<Record<string, unknown>>,
  protocolVersion: string | undefined,
  schema: z.ZodTypeAny | undefined,
  options?: {readonly defaultCatalogSchema: z.ZodTypeAny | undefined},
): ComponentPayloadState {
  if (!isAtLeastVersion(protocolVersion, '1.0')) {
    const {id: _id, component: _component, ...properties} = comp;
    return {properties, metadata: undefined};
  }
  let layout = componentMixinLayout(schema);
  if (options) layout = routeLegacyCatalogId(layout, comp, options.defaultCatalogSchema);
  const {properties, mixins} = splitComponentEnvelope(comp, layout);
  if (mixins.accessibility) properties[atMixinKey('accessibility')] = mixins.accessibility.value;
  if (mixins.checks) properties[atMixinKey('checks')] = mixins.checks.value;
  return {properties, metadata: mixins.metadata?.value};
}
