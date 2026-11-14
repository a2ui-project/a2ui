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
 *
 * TODO(#4082): remove the legacy bare v1.0 mixin fallback. It only exists so
 * agents written before the `@` keys keep working during the transition.
 */

import {A2uiValidationError} from '../errors.js';
import {isAtLeastVersion} from '../common/semver.js';
import {definitionName, deref, unwrapField, type SchemaCursor} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';

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
const layoutCache = new WeakMap<object, WeakMap<object, ComponentMixinLayout>>();

/** The common types definitions whose properties are the envelope mixins. */
const SPEC_MIXIN_DEFS: ReadonlySet<string> = new Set(['ComponentCommon', 'Checkable']);

type Obj = {[k: string]: unknown};

const isObj = (n: unknown): n is Obj => typeof n === 'object' && n !== null && !Array.isArray(n);

/** Whether `root` is the document a cursor references as `common_types.json`. */
function isCommonTypes(root: JsonSchema, cursor: SchemaCursor): boolean {
  return Object.entries(cursor.doc.defs).some(
    ([key, document]) =>
      document === root && key.slice(key.lastIndexOf('/') + 1) === 'common_types.json',
  );
}

/** A property a component schema declares, with the object that declares it. */
interface PropertyDeclaration {
  /** The property's schema. */
  readonly schema: SchemaCursor;
  /** The names of the properties of the object that declares it. */
  readonly siblings: ReadonlySet<string>;
  /** The spec mixin definition (`ComponentCommon`, `Checkable`) that declares it, if any. */
  readonly mixin: string | undefined;
}

/**
 * Collects every property a component schema declares, keyed by name.
 *
 * Follows `$ref`s and walks `allOf`, `anyOf`, and `oneOf`, so a property
 * declared in any branch counts as declared. A name declared in several
 * branches keeps each of its declarations. A property reached through a
 * `$ref` to the common types' `ComponentCommon` or `Checkable` is a standard
 * mixin property. A `$ref` that does not resolve declares nothing.
 *
 * @param cursor A component schema and its document.
 * @param declared The map to add the declarations to.
 * @param inMixin The spec mixin definition `cursor` is inside, if any.
 * @param visited The nodes already walked, so that a schema shared by
 *   several branches, or reached again through a cycle, is walked once.
 * @returns `declared`.
 */
function collectDeclaredProperties(
  cursor: SchemaCursor,
  declared = new Map<string, PropertyDeclaration[]>(),
  inMixin: string | undefined = undefined,
  visited = new Set<object>(),
): Map<string, PropertyDeclaration[]> {
  let target: SchemaCursor & {refName?: string};
  try {
    target = deref(cursor.node, cursor.doc);
  } catch {
    return declared;
  }
  const node = target.node;
  if (!isObj(node) || visited.has(node)) return declared;
  visited.add(node);
  // Only a definition of the common types is a spec mixin; a catalog's own
  // `$defs/Checkable` is an ordinary definition, even when it is reached
  // through the catalog document (`catalog.json`).
  const mixin =
    inMixin ??
    (target.refName !== undefined &&
    SPEC_MIXIN_DEFS.has(target.refName) &&
    isCommonTypes(target.doc.root, cursor)
      ? target.refName
      : undefined);
  if (isObj(node['properties'])) {
    const siblings = new Set(Object.keys(node['properties']));
    for (const [key, prop] of Object.entries(node['properties'])) {
      const declaration = {
        schema: {node: prop as JsonSchema, doc: target.doc},
        siblings,
        mixin,
      };
      const declarations = declared.get(key);
      if (declarations) {
        declarations.push(declaration);
      } else {
        declared.set(key, [declaration]);
      }
    }
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const members = node[key];
    if (!Array.isArray(members)) continue;
    for (const member of members) {
      collectDeclaredProperties(
        {node: member as JsonSchema, doc: target.doc},
        declared,
        mixin,
        visited,
      );
    }
  }
  return declared;
}

/**
 * Whether a property schema a component declares under a mixin's bare name
 * is the standard mixin schema rather than a custom property.
 *
 * A property of a spec mixin definition is standard. Otherwise `checks` is
 * standard as an array of `CheckRule`s and `accessibility` as an
 * `AccessibilityAttributes`. A `catalogId` or `metadata` declared inline is
 * the standard mixin only as part of an inlined `ComponentCommon`: the object
 * that declares it must also declare `id`, and it must have the standard
 * shape (a string `catalogId`, or a `metadata` object whose only property is
 * `extensions`).
 */
function isStandardMixinProperty(
  key: ComponentMixinKey,
  {schema, siblings, mixin}: PropertyDeclaration,
): boolean {
  if (mixin !== undefined) return true;
  let field;
  try {
    field = unwrapField(schema.node, schema.doc, true);
  } catch {
    return false;
  }
  const inner = isObj(field.node) ? field.node : {};
  switch (key) {
    case 'checks': {
      const items = inner['items'];
      return (
        inner['type'] === 'array' &&
        isObj(items) &&
        definitionName(items, field.doc) === 'CheckRule'
      );
    }
    case 'accessibility':
      return definitionName(schema.node, schema.doc) === 'AccessibilityAttributes';
    case 'catalogId':
      return siblings.has('id') && inner['type'] === 'string';
    case 'metadata': {
      const properties = inner['properties'];
      if (!siblings.has('id') || inner['type'] !== 'object' || !isObj(properties)) return false;
      const keys = Object.keys(properties);
      return keys.length === 1 && keys[0] === 'extensions';
    }
  }
}

/**
 * Describes how a component's schema declares the envelope mixins: which bare
 * mixin names it declares as custom properties, and under which keys it
 * declares the standard mixins.
 *
 * Properties declared in any `allOf`, `anyOf`, or `oneOf` branch count, and
 * the mixins are found by `$ref` to the spec's `ComponentCommon` and
 * `Checkable` definitions. A bare mixin name is the standard mixin only if
 * every branch that declares it uses the standard schema; otherwise it is a
 * custom property.
 *
 * @param cursor The component's schema and its document, if known.
 * @returns The component's mixin layout.
 */
export function componentMixinLayout(cursor: SchemaCursor | undefined): ComponentMixinLayout {
  if (!cursor || !isObj(cursor.node) || !isObj(cursor.doc.root)) return EMPTY_LAYOUT;
  let byNode = layoutCache.get(cursor.doc.root);
  if (!byNode) {
    byNode = new WeakMap();
    layoutCache.set(cursor.doc.root, byNode);
  }
  const cached = byNode.get(cursor.node);
  if (cached) return cached;
  const declared = collectDeclaredProperties(cursor);
  // The component's catalog is an envelope field, like its `id`: `@catalogId`
  // is never one of its properties, however it is declared, and neither is
  // the bare `catalogId` of `ComponentCommon`.
  declared.delete(atMixinKey('catalogId'));
  const ownCatalogId = declared.get('catalogId')?.filter(({mixin}) => mixin !== 'ComponentCommon');
  if (ownCatalogId?.length) declared.set('catalogId', ownCatalogId);
  else declared.delete('catalogId');
  const customKeys = new Set<ComponentMixinKey>();
  const schemaKeys = new Map<ComponentMixinKey, string>();
  for (const key of COMPONENT_MIXIN_KEYS) {
    const atKey = atMixinKey(key);
    const bare = declared.get(key);
    const standard = (declarations: PropertyDeclaration[]) =>
      declarations.every(declaration => isStandardMixinProperty(key, declaration));
    if (declared.has(atKey)) {
      schemaKeys.set(key, atKey);
      // A mixin such as Checkable can declare both its `@`-prefixed and its
      // legacy bare key. Only a bare key with some other schema is custom.
      if (bare && !standard(bare)) customKeys.add(key);
    } else if (bare) {
      if (standard(bare)) {
        schemaKeys.set(key, key);
      } else {
        customKeys.add(key);
      }
    }
  }
  const layout = {customKeys, schemaKeys};
  byNode.set(cursor.node, layout);
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
 * @param defaultCatalogSchema The component's schema and its document in
 *   the surface's default catalog, if that catalog defines its type.
 * @returns `layout`, or a copy that treats the bare `catalogId` as the mixin.
 */
export function routeLegacyCatalogId(
  layout: ComponentMixinLayout,
  comp: Readonly<Record<string, unknown>>,
  defaultCatalogSchema: SchemaCursor | undefined,
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
        [{path: `/${atKey}`, code: 'invalid_value', message: msg}],
        'VALIDATION_ERROR',
        {path: `/${atKey}`},
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
 * @param schema The component's schema and its document, if known.
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
  schema: SchemaCursor | undefined,
  options?: {readonly defaultCatalogSchema: SchemaCursor | undefined},
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
