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
 * Checks the URLs in a payload against a URL security policy before the agent sends it.
 */

import {
  AgentToRendererMessage,
  applyUrlSecurityPolicy,
  BASIC_CATALOG_URL_PROPERTIES,
  BehaviorNode,
  CatalogApi,
  PermissiveUrlSecurityPolicy,
  redactUrl,
  scrapeSchemaBehavior,
  UrlCheckInfo,
  UrlContext,
  UrlContextAnnotation,
  UrlPropertyMap,
  UrlSecurityPolicy,
} from '../internal/web-core.js';

/** Options for `checkPayloadUrls`. */
export interface PayloadUrlCheckOptions {
  /**
   * The policy to check URLs against: the policy the renderer is configured with, or a
   * stricter one. Defaults to `PermissiveUrlSecurityPolicy`, which applies only the built-in
   * baseline checks.
   */
  policy?: UrlSecurityPolicy;
  /**
   * What to do with a blocked URL. `'report'`, the default, lists it and leaves the messages
   * as they are. `'strip'` also replaces the value holding it (the URL, or the binding to
   * it) with an empty string in a copy of the messages. The renderer's baseline blocks an
   * empty URL, so the property resolves to unset, as it would after the renderer blocked the
   * URL itself, and the message still matches the catalog's schema.
   */
  onBlocked?: 'report' | 'strip';
}

/** A URL that the policy blocked, as `checkPayloadUrls` reports it. */
export interface BlockedPayloadUrl {
  /** Index of the message holding the URL, or the binding to it, in the payload. */
  readonly messageIndex: number;
  /** The surface the URL appears on. */
  readonly surfaceId: string;
  /** The catalog of the component or theme holding the URL, when known. */
  readonly catalogId?: string;
  /** The component holding the URL; absent for the surface theme. */
  readonly componentId?: string;
  /** The type of the component holding the URL, such as `'Image'`. */
  readonly componentType?: string;
  /**
   * The property holding the URL, as a path with `[]` for list items, such as `'url'`,
   * `'items[].imageUrl'`, or `'theme.iconUrl'`.
   */
  readonly propertyName: string;
  /** How the renderer uses the URL. */
  readonly context: UrlContext;
  /**
   * The URL with its path, query, fragment, user info, and `data:` payload removed, any of
   * which may carry data the URL was meant to leak. Safe to log.
   */
  readonly redactedUrl: string;
  /** The data model path the property is bound to, when the URL comes from the data model. */
  readonly dataPath?: string;
}

/** The result of `checkPayloadUrls`. */
export interface PayloadUrlCheckResult {
  /**
   * The messages to send. With `onBlocked: 'report'`, or when nothing is blocked, these are
   * the payload's own message objects. With `onBlocked: 'strip'`, the messages that held a
   * blocked URL are copies with each blocked value replaced by an empty string.
   */
  readonly messages: AgentToRendererMessage[];
  /** Every blocked URL, in payload order. Empty when every URL passes. */
  readonly blocked: BlockedPayloadUrl[];
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A component in the payload, with where to find it. */
interface PayloadComponent {
  readonly messageIndex: number;
  readonly surfaceId: string;
  readonly component: JsonObject;
  /** The component's position in its message's `components` list. */
  readonly listIndex: number;
  /** Whether the list is `createSurface.components` rather than `updateComponents.components`. */
  readonly inCreateSurface: boolean;
}

/** What the payload says about one surface. */
interface PayloadSurface {
  catalogId?: string;
  dataModel?: unknown;
}

/** A value to replace in a message copy. */
interface StripTarget {
  readonly messageIndex: number;
  /** Path from the message object to the property. */
  readonly path: readonly (string | number)[];
}

/**
 * Checks the URLs in a payload against a URL security policy, the way a renderer would,
 * before the agent sends it.
 *
 * The renderer applies its own policy whatever the agent does, so the check is an optional,
 * earlier line: it lets an agent log, drop, or retry a response from a model that was
 * prompted into putting data into a URL, before the payload leaves the agent.
 *
 * Which properties hold URLs comes from the catalogs: a property marked with
 * `x-a2ui-url-context` (written by `mediaUrl()` and its kin), the built-in list for the
 * basic catalogs' `Image`, `Video`, and `AudioPlayer`, and the policy's `urlProperties` map,
 * which wins over the catalog. The basic catalogs' `theme.iconUrl` is checked as `media`.
 *
 * Each value is checked as the renderer resolves it:
 *
 * - A literal string is checked as is.
 * - A data binding with an absolute path is checked against the value the payload's
 *   `createSurface.dataModel` and `updateDataModel` messages leave at that path, if any.
 * - A relative binding (inside a list template), a binding to a value the payload doesn't
 *   set, and a function call such as `formatString` can't be resolved without the
 *   renderer's state, so they are not checked here; the renderer checks them.
 *
 * Each component is checked against its surface's catalog, from the payload's
 * `createSurface`, or, for a surface the payload only updates, the first catalog that
 * defines the component's type.
 *
 * @param catalogs The active catalogs.
 * @param payload One message, or an iterable of messages, as parsed JSON objects. Messages
 *     that are not v0.9 or v1.0 surface messages are passed through unchecked.
 * @param options The policy and what to do with blocked URLs.
 * @returns The messages to send and the blocked URLs.
 */
export function checkPayloadUrls(
  catalogs: CatalogApi[],
  payload: unknown,
  options: PayloadUrlCheckOptions = {},
): PayloadUrlCheckResult {
  const policy = options.policy ?? new PermissiveUrlSecurityPolicy();
  const messages = toMessageList(payload);
  const surfaces = new Map<string, PayloadSurface>();
  const components: PayloadComponent[] = [];
  const themes: {messageIndex: number; surfaceId: string; theme: JsonObject}[] = [];

  messages.forEach((message, messageIndex) => {
    if (!isJsonObject(message)) return;
    const create = message['createSurface'];
    if (isJsonObject(create) && typeof create['surfaceId'] === 'string') {
      const surfaceId = create['surfaceId'];
      const surface: PayloadSurface = {};
      if (typeof create['catalogId'] === 'string') surface.catalogId = create['catalogId'];
      if ('dataModel' in create) surface.dataModel = create['dataModel'];
      surfaces.set(surfaceId, surface);
      if (isJsonObject(create['theme'])) {
        themes.push({messageIndex, surfaceId, theme: create['theme']});
      }
      collectComponents(create['components'], messageIndex, surfaceId, true, components);
    }
    const update = message['updateComponents'];
    if (isJsonObject(update) && typeof update['surfaceId'] === 'string') {
      collectComponents(update['components'], messageIndex, update['surfaceId'], false, components);
    }
    const data = message['updateDataModel'];
    if (isJsonObject(data) && typeof data['surfaceId'] === 'string') {
      const surface = surfaces.get(data['surfaceId']) ?? {};
      surfaces.set(data['surfaceId'], surface);
      surface.dataModel = applyDataUpdate(
        surface.dataModel,
        typeof data['path'] === 'string' ? data['path'] : '/',
        'value' in data ? data['value'] : undefined,
        'value' in data,
      );
    }
  });

  const blocked: BlockedPayloadUrl[] = [];
  const strip: StripTarget[] = [];
  const check = (
    url: unknown,
    context: UrlContext,
    found: Omit<BlockedPayloadUrl, 'context' | 'redactedUrl'>,
    stripPath: readonly (string | number)[],
  ) => {
    if (typeof url !== 'string') return;
    const info: UrlCheckInfo = {
      surfaceId: found.surfaceId,
      catalogId: found.catalogId,
      componentType: found.componentType,
      componentId: found.componentId,
      propertyName: found.propertyName,
    };
    if (applyUrlSecurityPolicy(policy, url, context, info) !== undefined) return;
    blocked.push({...found, context, redactedUrl: redactUrl(url)});
    strip.push({messageIndex: found.messageIndex, path: stripPath});
  };

  for (const {messageIndex, surfaceId, theme} of themes) {
    const catalogId = surfaces.get(surfaceId)?.catalogId;
    if (catalogId === undefined || !isBasicCatalog(catalogId)) continue;
    check(
      theme['iconUrl'],
      'media',
      {messageIndex, surfaceId, catalogId, propertyName: 'theme.iconUrl'},
      ['createSurface', 'theme', 'iconUrl'],
    );
  }

  const behaviorCache = new Map<string, Extract<BehaviorNode, {type: 'OBJECT'}> | null>();
  for (const entry of components) {
    const type = entry.component['component'];
    if (typeof type !== 'string') continue;
    const surface = surfaces.get(entry.surfaceId);
    const catalog = findCatalog(catalogs, surface?.catalogId, type);
    if (catalog === undefined) continue;
    const cacheKey = JSON.stringify([catalog.id, type]);
    if (!behaviorCache.has(cacheKey)) {
      behaviorCache.set(cacheKey, urlBehaviorOf(catalog, type, policy.urlProperties));
    }
    const behavior = behaviorCache.get(cacheKey);
    if (!behavior) continue;
    const componentId =
      typeof entry.component['id'] === 'string' ? entry.component['id'] : undefined;
    const base = [
      entry.inCreateSurface ? 'createSurface' : 'updateComponents',
      'components',
      entry.listIndex,
    ];
    walkUrls(behavior, entry.component, [], (url, context, path) => {
      const propertyName = propertyNameOf(path);
      const found = {
        messageIndex: entry.messageIndex,
        surfaceId: entry.surfaceId,
        catalogId: catalog.id,
        componentId,
        componentType: type,
        propertyName,
      };
      const dataPath = absoluteBindingPath(url);
      if (dataPath === undefined) {
        check(url, context, found, [...base, ...path]);
      } else {
        const resolved = readPointer(surface?.dataModel, dataPath);
        check(resolved, context, {...found, dataPath}, [...base, ...path]);
      }
    });
  }

  if (options.onBlocked !== 'strip' || strip.length === 0) {
    return {messages: messages as AgentToRendererMessage[], blocked};
  }
  const copies = new Map<number, JsonObject>();
  for (const {messageIndex, path} of strip) {
    let copy = copies.get(messageIndex);
    if (copy === undefined) {
      copy = structuredClone(messages[messageIndex]) as JsonObject;
      copies.set(messageIndex, copy);
    }
    replaceAt(copy, path, '');
  }
  return {
    messages: messages.map((m, i) => copies.get(i) ?? m) as AgentToRendererMessage[],
    blocked,
  };
}

function toMessageList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (
    payload !== null &&
    typeof payload === 'object' &&
    Symbol.iterator in payload &&
    typeof (payload as Iterable<unknown>)[Symbol.iterator] === 'function'
  ) {
    return [...(payload as Iterable<unknown>)];
  }
  return [payload];
}

function collectComponents(
  list: unknown,
  messageIndex: number,
  surfaceId: string,
  inCreateSurface: boolean,
  into: PayloadComponent[],
): void {
  if (!Array.isArray(list)) return;
  list.forEach((component, listIndex) => {
    if (isJsonObject(component)) {
      into.push({messageIndex, surfaceId, component, listIndex, inCreateSurface});
    }
  });
}

function isBasicCatalog(catalogId: string): boolean {
  return Object.hasOwn(BASIC_CATALOG_URL_PROPERTIES, catalogId);
}

function findCatalog(
  catalogs: CatalogApi[],
  catalogId: string | undefined,
  componentType: string,
): CatalogApi | undefined {
  if (catalogId !== undefined) {
    const named = catalogs.find(c => c.id === catalogId);
    if (named !== undefined) return named.components.has(componentType) ? named : undefined;
  }
  return catalogs.find(c => c.components.has(componentType));
}

function lookupUrlProperties(
  map: UrlPropertyMap | undefined,
  catalogId: string,
  componentType: string,
): Readonly<Record<string, UrlContextAnnotation>> | undefined {
  return map && Object.hasOwn(map, catalogId) && Object.hasOwn(map[catalogId], componentType)
    ? map[catalogId][componentType]
    : undefined;
}

/**
 * The behavior tree of a component with the URL contexts the renderer applies: those of the
 * schema, the built-in list where the schema has none, and the host's map, which wins. Like
 * the renderer, the lists mark top-level properties only. Returns `null` when no property of
 * the component holds a URL.
 */
function urlBehaviorOf(
  catalog: CatalogApi,
  componentType: string,
  urlProperties: UrlPropertyMap | undefined,
): Extract<BehaviorNode, {type: 'OBJECT'}> | null {
  const api = catalog.components.get(componentType);
  if (api === undefined) return null;
  const tree = scrapeSchemaBehavior(api.schema);
  const shape: Record<string, BehaviorNode> = tree.type === 'OBJECT' ? {...tree.shape} : {};
  const apply = (property: string, urlContext: UrlContextAnnotation, overrideSchema: boolean) => {
    const node = shape[property] ?? {type: 'STATIC'};
    if (node.type !== 'DYNAMIC' && node.type !== 'STATIC') return;
    if (!overrideSchema && node.urlContext !== undefined) return;
    shape[property] = {...node, urlContext};
  };
  const builtIn = lookupUrlProperties(BASIC_CATALOG_URL_PROPERTIES, catalog.id, componentType);
  for (const [property, urlContext] of Object.entries(builtIn ?? {})) {
    apply(property, urlContext, false);
  }
  const host = lookupUrlProperties(urlProperties, catalog.id, componentType);
  for (const [property, urlContext] of Object.entries(host ?? {})) {
    apply(property, urlContext, true);
  }
  const result: Extract<BehaviorNode, {type: 'OBJECT'}> = {type: 'OBJECT', shape};
  return hasUrlNode(result) ? result : null;
}

function hasUrlNode(node: BehaviorNode, seen = new Set<BehaviorNode>()): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  switch (node.type) {
    case 'DYNAMIC':
    case 'STATIC':
      return node.urlContext !== undefined && node.urlContext !== 'none';
    case 'OBJECT':
      return Object.values(node.shape).some(child => hasUrlNode(child, seen));
    case 'ARRAY':
      return hasUrlNode(node.element, seen);
    default:
      return false;
  }
}

/** Calls `visit` with each value the behavior tree marks as a URL. */
function walkUrls(
  node: BehaviorNode,
  value: unknown,
  path: (string | number)[],
  visit: (value: unknown, context: UrlContext, path: (string | number)[]) => void,
): void {
  switch (node.type) {
    case 'DYNAMIC':
    case 'STATIC':
      if (node.urlContext !== undefined && node.urlContext !== 'none' && value !== undefined) {
        visit(value, node.urlContext, path);
      }
      return;
    case 'OBJECT':
      if (!isJsonObject(value)) return;
      for (const [key, child] of Object.entries(node.shape)) {
        if (Object.hasOwn(value, key)) walkUrls(child, value[key], [...path, key], visit);
      }
      return;
    case 'ARRAY':
      if (!Array.isArray(value)) return;
      value.forEach((item, i) => walkUrls(node.element, item, [...path, i], visit));
      return;
    default:
      return;
  }
}

/** Writes a property path as `UrlCheckInfo.propertyName` does, such as `items[].imageUrl`. */
function propertyNameOf(path: readonly (string | number)[]): string {
  let name = '';
  for (const segment of path) {
    if (typeof segment === 'number') name += '[]';
    else name += name ? `.${segment}` : segment;
  }
  return name;
}

/**
 * The absolute data model path of a data binding (`{"@path": ...}` in v1.0, `{"path": ...}`
 * in v0.9), or `undefined` for anything else, including a relative binding.
 */
function absoluteBindingPath(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1) return undefined;
  const path = value['@path'] ?? value['path'];
  return typeof path === 'string' && path.startsWith('/') ? path : undefined;
}

function pointerSegments(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return [];
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readPointer(root: unknown, pointer: string): unknown {
  let current = root;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else if (isJsonObject(current) && Object.hasOwn(current, segment)) current = current[segment];
    else return undefined;
  }
  return current;
}

/** Applies an `updateDataModel` to a copy of the data model and returns the result. */
function applyDataUpdate(
  root: unknown,
  pointer: string,
  value: unknown,
  hasValue: boolean,
): unknown {
  const segments = pointerSegments(pointer);
  if (segments.length === 0) return hasValue ? value : undefined;
  const result: unknown = isJsonObject(root) || Array.isArray(root) ? structuredClone(root) : {};
  let current = result as JsonObject | unknown[];
  for (const segment of segments.slice(0, -1)) {
    const next = (current as JsonObject)[segment];
    if (!isJsonObject(next) && !Array.isArray(next)) (current as JsonObject)[segment] = {};
    current = (current as JsonObject)[segment] as JsonObject | unknown[];
  }
  const last = segments[segments.length - 1];
  if (hasValue) (current as JsonObject)[last] = value;
  else delete (current as JsonObject)[last];
  return result;
}

function replaceAt(root: JsonObject, path: readonly (string | number)[], value: unknown): void {
  let current: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (current === null || typeof current !== 'object') return;
    current = (current as Record<string | number, unknown>)[segment];
  }
  if (current !== null && typeof current === 'object') {
    (current as Record<string | number, unknown>)[path[path.length - 1]] = value;
  }
}
