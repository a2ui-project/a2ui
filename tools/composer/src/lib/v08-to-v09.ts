/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {A2UIComponent} from '@/types/widget';

export interface V09Component {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface NormalizedSurfaceInput {
  root: string;
  components: V09Component[];
  data: Record<string, unknown>;
}

export const EMPTY_DATA: Record<string, unknown> = Object.freeze({});

interface DataBinding {
  path: string;
}

interface FunctionCall {
  call: string;
  args?: Record<string, unknown>;
  returnType?: string;
}

type DynamicScalar<T> = T | DataBinding | FunctionCall;

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const ICON_OVERRIDES_REVERSE: Record<string, string> = {
  play_arrow: 'play',
  fast_rewind: 'rewind',
  favorite_border: 'favoriteOff',
  star_border: 'starOff',
};

const V09_ICON_NAMES = new Set([
  'accountCircle',
  'add',
  'arrowBack',
  'arrowForward',
  'attachFile',
  'calendarToday',
  'call',
  'camera',
  'check',
  'close',
  'delete',
  'download',
  'edit',
  'event',
  'error',
  'fastForward',
  'favorite',
  'favoriteOff',
  'folder',
  'help',
  'home',
  'info',
  'locationOn',
  'lock',
  'lockOpen',
  'mail',
  'menu',
  'moreVert',
  'moreHoriz',
  'notificationsOff',
  'notifications',
  'pause',
  'payment',
  'person',
  'phone',
  'photo',
  'play',
  'print',
  'refresh',
  'rewind',
  'search',
  'send',
  'settings',
  'share',
  'shoppingCart',
  'skipNext',
  'skipPrevious',
  'star',
  'starHalf',
  'starOff',
  'stop',
  'upload',
  'visibility',
  'visibilityOff',
  'volumeDown',
  'volumeMute',
  'volumeOff',
  'volumeUp',
  'warning',
]);

const TEXT_VARIANTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body']);
const IMAGE_VARIANTS = new Set([
  'icon',
  'avatar',
  'smallFeature',
  'mediumFeature',
  'largeFeature',
  'header',
]);
const IMAGE_FITS = new Set(['contain', 'cover', 'fill', 'none', 'scaleDown']);
const FLEX_JUSTIFY = new Set([
  'start',
  'center',
  'end',
  'spaceBetween',
  'spaceAround',
  'spaceEvenly',
  'stretch',
]);
const FLEX_ALIGN = new Set(['start', 'center', 'end', 'stretch']);
const LIST_DIRECTIONS = new Set(['vertical', 'horizontal']);
const LIST_STYLES = new Set(['ordered', 'unordered', 'none']);
const DIVIDER_AXES = new Set(['horizontal', 'vertical']);
const BUTTON_VARIANTS = new Set(['default', 'primary', 'borderless']);
const TEXTFIELD_VARIANTS = new Set(['longText', 'number', 'shortText', 'obscured']);
const CHOICE_VARIANTS = new Set(['multipleSelection', 'mutuallyExclusive']);
const CHOICE_DISPLAY_STYLES = new Set(['checkbox', 'chips']);

const ICON_DATA_KEY = '__a2ui_icons';

function isRecord(val: unknown): val is Record<string, unknown> {
  return !Array.isArray(val) && typeof val === 'object' && val !== null;
}

function setSafeProp(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function unescapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function splitJsonPointer(pointer: string): string[] {
  const trimmed = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  if (!trimmed) return [];
  return trimmed.split('/').map(unescapeJsonPointerSegment);
}

function getAtSegments(obj: Record<string, unknown>, segments: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of segments) {
    if (!isRecord(cur) || UNSAFE_KEYS.has(seg) || !Object.hasOwn(cur, seg)) {
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}

function setAtSegmentsImmutable(
  obj: Record<string, unknown>,
  segments: string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return isRecord(value) ? {...value} : obj;
  }
  if (UNSAFE_KEYS.has(head)) {
    return obj;
  }
  const copy: Record<string, unknown> = {...obj};
  if (rest.length === 0) {
    setSafeProp(copy, head, value);
    return copy;
  }
  const existing =
    Object.hasOwn(obj, head) && isRecord(obj[head]) ? (obj[head] as Record<string, unknown>) : {};
  setSafeProp(copy, head, setAtSegmentsImmutable(existing, rest, value));
  return copy;
}

function extractV08Envelope(
  comp: A2UIComponent,
): {type: string; props: Record<string, unknown>; weight?: number} | null {
  const weight = typeof comp['weight'] === 'number' ? (comp['weight'] as number) : undefined;
  const rawComp = comp['component'];
  if (typeof rawComp === 'string' || !isRecord(rawComp)) {
    return null;
  }
  const [type] = Object.keys(rawComp);
  if (type === undefined) {
    return null;
  }
  const inner = rawComp[type];
  const props = isRecord(inner) ? inner : {};
  const resolvedWeight =
    weight ?? (typeof props['weight'] === 'number' ? (props['weight'] as number) : undefined);
  return {type, props, weight: resolvedWeight};
}

function extractComponentProps(comp: A2UIComponent): Record<string, unknown> {
  const env = extractV08Envelope(comp);
  return env ? env.props : comp;
}

function extractTemplateEdge(
  props: Record<string, unknown>,
): {componentId: string; rawBinding: string} | null {
  const children = props['children'];
  if (!isRecord(children)) return null;
  if (isRecord(children['template'])) {
    const tmpl = children['template'];
    const componentId = typeof tmpl['componentId'] === 'string' ? tmpl['componentId'] : '';
    const rawBinding =
      typeof tmpl['dataBinding'] === 'string'
        ? tmpl['dataBinding']
        : typeof tmpl['path'] === 'string'
          ? tmpl['path']
          : '/';
    if (componentId) {
      return {componentId, rawBinding};
    }
  } else if (typeof children['componentId'] === 'string' && children['componentId']) {
    const rawBinding = typeof children['path'] === 'string' ? children['path'] : '/';
    return {componentId: children['componentId'], rawBinding};
  }
  return null;
}

function collectNonTemplateChildIds(props: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const key of ['child', 'entryPointChild', 'contentChild', 'trigger', 'content']) {
    if (typeof props[key] === 'string' && props[key]) {
      ids.push(props[key] as string);
    }
  }
  const children = props['children'];
  if (Array.isArray(children)) {
    for (const id of children) {
      if (typeof id === 'string' && id) ids.push(id);
    }
  } else if (isRecord(children) && Array.isArray(children['explicitList'])) {
    for (const id of children['explicitList']) {
      if (typeof id === 'string' && id) ids.push(id);
    }
  }
  const tabs = props['tabItems'] ?? props['tabs'];
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (isRecord(tab) && typeof tab['child'] === 'string' && tab['child']) {
        ids.push(tab['child'] as string);
      }
    }
  }
  return ids;
}

function rewriteComponentChildRefs(
  comp: A2UIComponent,
  mapNonTemplateId: (id: string) => string,
  mapTemplateId: (id: string) => string,
): A2UIComponent {
  const rewriteProps = (props: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = {...props};
    for (const key of ['child', 'entryPointChild', 'contentChild', 'trigger', 'content']) {
      if (typeof next[key] === 'string') {
        next[key] = mapNonTemplateId(next[key] as string);
      }
    }
    const children = next['children'];
    if (Array.isArray(children)) {
      next['children'] = children.map(item =>
        typeof item === 'string' ? mapNonTemplateId(item) : item,
      );
    } else if (isRecord(children)) {
      const nextChildren: Record<string, unknown> = {...children};
      if (Array.isArray(nextChildren['explicitList'])) {
        nextChildren['explicitList'] = nextChildren['explicitList'].map(item =>
          typeof item === 'string' ? mapNonTemplateId(item) : item,
        );
      }
      if (
        isRecord(nextChildren['template']) &&
        typeof nextChildren['template']['componentId'] === 'string'
      ) {
        nextChildren['template'] = {
          ...nextChildren['template'],
          componentId: mapTemplateId(nextChildren['template']['componentId'] as string),
        };
      } else if (typeof nextChildren['componentId'] === 'string') {
        nextChildren['componentId'] = mapTemplateId(nextChildren['componentId'] as string);
      }
      next['children'] = nextChildren;
    }
    for (const tabKey of ['tabItems', 'tabs']) {
      if (Array.isArray(next[tabKey])) {
        next[tabKey] = (next[tabKey] as unknown[]).map(tab =>
          isRecord(tab) && typeof tab['child'] === 'string'
            ? {...tab, child: mapNonTemplateId(tab['child'] as string)}
            : tab,
        );
      }
    }
    return next;
  };

  const rawComp = comp['component'];
  if (typeof rawComp !== 'string' && isRecord(rawComp)) {
    const [type] = Object.keys(rawComp);
    if (type !== undefined && isRecord(rawComp[type])) {
      return {
        ...comp,
        component: {
          ...rawComp,
          [type]: rewriteProps(rawComp[type] as Record<string, unknown>),
        },
      };
    }
  }
  return rewriteProps(comp) as A2UIComponent;
}

/**
 * Clones components that are reachable both from `root` outside any template and inside
 * a template subtree so template path relativization never alters root-scoped instances.
 */
function separateSharedTemplateNodes(root: string, components: A2UIComponent[]): A2UIComponent[] {
  const byId = new Map<string, A2UIComponent>();
  const allIds = new Set<string>();
  for (const comp of components) {
    byId.set(comp.id, comp);
    allIds.add(comp.id);
  }

  if (!root || !byId.has(root)) {
    return components;
  }

  const nonTemplateIds = new Set<string>();
  const rootQueue: string[] = [root];
  while (rootQueue.length > 0) {
    const id = rootQueue.shift()!;
    if (nonTemplateIds.has(id)) continue;
    const comp = byId.get(id);
    if (!comp) continue;
    nonTemplateIds.add(id);
    for (const kid of collectNonTemplateChildIds(extractComponentProps(comp))) {
      if (!nonTemplateIds.has(kid)) {
        rootQueue.push(kid);
      }
    }
  }

  const templateReachable = new Set<string>();
  const tmplQueue: string[] = [];
  for (const comp of components) {
    const edge = extractTemplateEdge(extractComponentProps(comp));
    if (edge && byId.has(edge.componentId)) {
      tmplQueue.push(edge.componentId);
    }
  }
  while (tmplQueue.length > 0) {
    const id = tmplQueue.shift()!;
    if (templateReachable.has(id)) continue;
    const comp = byId.get(id);
    if (!comp) continue;
    templateReachable.add(id);
    const props = extractComponentProps(comp);
    for (const kid of collectNonTemplateChildIds(props)) {
      if (!templateReachable.has(kid)) tmplQueue.push(kid);
    }
    const edge = extractTemplateEdge(props);
    if (edge && !templateReachable.has(edge.componentId)) {
      tmplQueue.push(edge.componentId);
    }
  }

  const cloneMap = new Map<string, string>();
  for (const id of templateReachable) {
    if (nonTemplateIds.has(id)) {
      let candidate = `${id}__tmpl`;
      let counter = 1;
      while (allIds.has(candidate)) {
        candidate = `${id}__tmpl_${counter++}`;
      }
      allIds.add(candidate);
      cloneMap.set(id, candidate);
    }
  }

  if (cloneMap.size === 0) {
    return components;
  }

  const mapId = (id: string): string => cloneMap.get(id) ?? id;
  const identity = (id: string): string => id;

  const result: A2UIComponent[] = components.map(comp => {
    if (nonTemplateIds.has(comp.id)) {
      return rewriteComponentChildRefs(comp, identity, mapId);
    }
    if (templateReachable.has(comp.id)) {
      return rewriteComponentChildRefs(comp, mapId, mapId);
    }
    return comp;
  });

  for (const [origId, clonedId] of cloneMap.entries()) {
    const orig = byId.get(origId);
    if (!orig) continue;
    const cloned = rewriteComponentChildRefs({...orig, id: clonedId}, mapId, mapId);
    result.push(cloned);
  }

  return result;
}

interface TemplateScope {
  containerId: string;
  componentId: string;
  rawBinding: string;
  parent: TemplateScope | null;
  children: TemplateScope[];
  itemKeys: Set<string>;
}

interface NormalizeContext {
  inTemplate: boolean;
  itemKeys: ReadonlySet<string>;
  rootData: Record<string, unknown>;
  existingIconRecord: Record<string, unknown> | null;
  iconBindings: Map<string, string>;
  initializers: Array<{path: string; value: unknown}>;
  stringListPaths: string[];
}

const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

function normalizeBindingPath(rawPath: string, ctx: NormalizeContext): string {
  if (!rawPath) return '/';
  if (!ctx.inTemplate) {
    return rawPath;
  }
  if (rawPath === '.' || rawPath === '/') {
    return rawPath;
  }
  let p = rawPath;
  if (p.startsWith('./')) {
    p = p.slice(2);
    if (!p) return '.';
  }
  if (!ctx.itemKeys.has('item')) {
    if (p === '/item' || p === 'item') {
      return '.';
    }
    if (p.startsWith('/item/')) {
      return p.slice('/item/'.length) || '.';
    }
    if (p.startsWith('item/')) {
      return p.slice('item/'.length) || '.';
    }
  }
  if (p.startsWith('/') && p.length > 1) {
    const firstSeg = unescapeJsonPointerSegment(p.slice(1).split('/')[0] ?? '');
    if (!firstSeg) return p;
    if (ctx.itemKeys.has(firstSeg)) {
      return p.slice(1);
    }
    if (Object.hasOwn(ctx.rootData, firstSeg)) {
      return p;
    }
    return p.slice(1);
  }
  return p;
}

function buildTemplateScopesAndData(
  components: A2UIComponent[],
  initialData: Record<string, unknown>,
): {
  scopeByComponentId: Map<string, TemplateScope>;
  normalizedData: Record<string, unknown>;
} {
  const nonTemplateKids = new Map<string, string[]>();
  const scopeByContainerId = new Map<string, TemplateScope>();
  const scopes: TemplateScope[] = [];

  for (const comp of components) {
    const props = extractComponentProps(comp);
    nonTemplateKids.set(comp.id, collectNonTemplateChildIds(props));
    const edge = extractTemplateEdge(props);
    if (edge) {
      const scope: TemplateScope = {
        containerId: comp.id,
        componentId: edge.componentId,
        rawBinding: edge.rawBinding,
        parent: null,
        children: [],
        itemKeys: new Set<string>(),
      };
      scopeByContainerId.set(comp.id, scope);
      scopes.push(scope);
    }
  }

  const immediateBodyByScope = new Map<TemplateScope, Set<string>>();
  for (const scope of scopes) {
    const body = new Set<string>();
    const queue: string[] = [scope.componentId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (body.has(id)) continue;
      body.add(id);
      for (const kid of nonTemplateKids.get(id) ?? []) {
        if (!body.has(kid)) queue.push(kid);
      }
      const nestedScope = scopeByContainerId.get(id);
      if (nestedScope && nestedScope !== scope && nestedScope.parent === null) {
        // Guard against cycles in malformed graphs.
        let ancestor: TemplateScope | null = scope;
        let createsCycle = false;
        while (ancestor) {
          if (ancestor === nestedScope) {
            createsCycle = true;
            break;
          }
          ancestor = ancestor.parent;
        }
        if (!createsCycle) {
          nestedScope.parent = scope;
          scope.children.push(nestedScope);
        }
      }
    }
    immediateBodyByScope.set(scope, body);
  }

  const scopeByComponentId = new Map<string, TemplateScope>();
  const assignScope = (scope: TemplateScope, visited: Set<TemplateScope>): void => {
    if (visited.has(scope)) return;
    visited.add(scope);
    for (const id of immediateBodyByScope.get(scope) ?? []) {
      scopeByComponentId.set(id, scope);
    }
    for (const child of scope.children) {
      assignScope(child, visited);
    }
  };
  for (const scope of scopes) {
    if (scope.parent === null) {
      assignScope(scope, new Set<TemplateScope>());
    }
  }
  for (const scope of scopes) {
    if (!immediateBodyByScope.get(scope)) continue;
    for (const id of immediateBodyByScope.get(scope)!) {
      if (!scopeByComponentId.has(id)) {
        scopeByComponentId.set(id, scope);
      }
    }
  }

  const convertScopeInRecord = (
    record: Record<string, unknown>,
    scope: TemplateScope,
    parentScope: TemplateScope | null,
    rootDataSnapshot: Record<string, unknown>,
    activeScopes: Set<TemplateScope>,
  ): Record<string, unknown> => {
    if (activeScopes.has(scope)) return record;
    activeScopes.add(scope);

    const resolvedBinding = parentScope
      ? normalizeBindingPath(scope.rawBinding, {
          inTemplate: true,
          itemKeys: parentScope.itemKeys,
          rootData: rootDataSnapshot,
          existingIconRecord: null,
          iconBindings: new Map(),
          initializers: [],
          stringListPaths: [],
        })
      : scope.rawBinding;

    const segments = splitJsonPointer(resolvedBinding);
    if (segments.length === 0) {
      activeScopes.delete(scope);
      return record;
    }

    const rawCollection = getAtSegments(record, segments);
    let itemsArray: unknown[] | undefined;
    let updatedRecord = record;

    if (Array.isArray(rawCollection)) {
      itemsArray = rawCollection;
    } else if (isRecord(rawCollection)) {
      itemsArray = Object.values(rawCollection);
      updatedRecord = setAtSegmentsImmutable(updatedRecord, segments, itemsArray);
    }

    if (!itemsArray) {
      activeScopes.delete(scope);
      return updatedRecord;
    }

    for (const item of itemsArray) {
      if (isRecord(item)) {
        for (const key of Object.keys(item)) {
          if (!UNSAFE_KEYS.has(key)) {
            scope.itemKeys.add(key);
          }
        }
      }
    }

    if (scope.children.length > 0) {
      let mutated = false;
      const nextItems = itemsArray.map(item => {
        if (!isRecord(item)) return item;
        let nextItem = item;
        for (const childScope of scope.children) {
          nextItem = convertScopeInRecord(
            nextItem,
            childScope,
            scope,
            rootDataSnapshot,
            activeScopes,
          );
        }
        if (nextItem !== item) mutated = true;
        return nextItem;
      });
      if (mutated) {
        updatedRecord = setAtSegmentsImmutable(updatedRecord, segments, nextItems);
      }
    }

    activeScopes.delete(scope);
    return updatedRecord;
  };

  let normalizedData = initialData;
  for (const scope of scopes) {
    if (scope.parent === null) {
      normalizedData = convertScopeInRecord(
        normalizedData,
        scope,
        null,
        normalizedData,
        new Set<TemplateScope>(),
      );
    }
  }

  return {scopeByComponentId, normalizedData};
}

function recordInitializer(boundPath: string, literal: unknown, ctx: NormalizeContext): void {
  if (!ctx.inTemplate && literal !== undefined && boundPath && boundPath !== '/') {
    ctx.initializers.push({path: boundPath, value: literal});
  }
}

function extractLiteralString(val: Record<string, unknown>): string | undefined {
  if (typeof val['literalString'] === 'string') return val['literalString'];
  if (typeof val['stringValue'] === 'string') return val['stringValue'];
  if (typeof val['literal'] === 'string') return val['literal'];
  return undefined;
}

function extractLiteralNumber(val: Record<string, unknown>): number | undefined {
  if (typeof val['literalNumber'] === 'number') return val['literalNumber'];
  if (typeof val['numberValue'] === 'number') return val['numberValue'];
  if (typeof val['literal'] === 'number') return val['literal'];
  return undefined;
}

function extractLiteralBoolean(val: Record<string, unknown>): boolean | undefined {
  if (typeof val['literalBoolean'] === 'boolean') return val['literalBoolean'];
  if (typeof val['booleanValue'] === 'boolean') return val['booleanValue'];
  if (typeof val['literal'] === 'boolean') return val['literal'];
  return undefined;
}

function extractLiteralStringList(val: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(val['literalArray'])) {
    return val['literalArray'].filter((item): item is string => typeof item === 'string');
  }
  if (Array.isArray(val['literal'])) {
    return val['literal'].filter((item): item is string => typeof item === 'string');
  }
  return undefined;
}

function extractLiteralAny(val: Record<string, unknown>): unknown {
  if (typeof val['literalString'] === 'string') return val['literalString'];
  if (typeof val['stringValue'] === 'string') return val['stringValue'];
  if (typeof val['literalNumber'] === 'number') return val['literalNumber'];
  if (typeof val['numberValue'] === 'number') return val['numberValue'];
  if (typeof val['literalBoolean'] === 'boolean') return val['literalBoolean'];
  if (typeof val['booleanValue'] === 'boolean') return val['booleanValue'];
  if (Array.isArray(val['literalArray'])) return val['literalArray'];
  if (
    typeof val['literal'] === 'string' ||
    typeof val['literal'] === 'number' ||
    typeof val['literal'] === 'boolean' ||
    Array.isArray(val['literal'])
  ) {
    return val['literal'];
  }
  return undefined;
}

function unwrapDynamicString(
  val: unknown,
  ctx: NormalizeContext,
): DynamicScalar<string> | undefined {
  if (typeof val === 'string') return val;
  if (!isRecord(val)) return undefined;
  const literal = extractLiteralString(val);
  if (typeof val['path'] === 'string') {
    const boundPath = normalizeBindingPath(val['path'], ctx);
    recordInitializer(boundPath, literal, ctx);
    return {path: boundPath};
  }
  if (literal !== undefined) return literal;
  if (typeof val['call'] === 'string') return val as unknown as FunctionCall;
  return undefined;
}

function unwrapDynamicNumber(
  val: unknown,
  ctx: NormalizeContext,
): DynamicScalar<number> | undefined {
  if (typeof val === 'number') return val;
  if (!isRecord(val)) return undefined;
  const literal = extractLiteralNumber(val);
  if (typeof val['path'] === 'string') {
    const boundPath = normalizeBindingPath(val['path'], ctx);
    recordInitializer(boundPath, literal, ctx);
    return {path: boundPath};
  }
  if (literal !== undefined) return literal;
  if (typeof val['call'] === 'string') return val as unknown as FunctionCall;
  return undefined;
}

function unwrapDynamicBoolean(
  val: unknown,
  ctx: NormalizeContext,
): DynamicScalar<boolean> | undefined {
  if (typeof val === 'boolean') return val;
  if (!isRecord(val)) return undefined;
  const literal = extractLiteralBoolean(val);
  if (typeof val['path'] === 'string') {
    const boundPath = normalizeBindingPath(val['path'], ctx);
    recordInitializer(boundPath, literal, ctx);
    return {path: boundPath};
  }
  if (literal !== undefined) return literal;
  if (typeof val['call'] === 'string') return val as unknown as FunctionCall;
  return undefined;
}

function unwrapDynamicStringList(
  val: unknown,
  ctx: NormalizeContext,
): DynamicScalar<string[]> | undefined {
  if (Array.isArray(val)) {
    return val.filter((item): item is string => typeof item === 'string');
  }
  if (!isRecord(val)) return undefined;
  const literal = extractLiteralStringList(val);
  if (typeof val['path'] === 'string') {
    const boundPath = normalizeBindingPath(val['path'], ctx);
    recordInitializer(boundPath, literal, ctx);
    return {path: boundPath};
  }
  if (literal !== undefined) return literal;
  if (typeof val['call'] === 'string') return val as unknown as FunctionCall;
  return undefined;
}

function unwrapDynamicValue(val: unknown, ctx: NormalizeContext): unknown {
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val)) {
    return val
      .map(item => unwrapDynamicValue(item, ctx))
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
  }
  if (!isRecord(val)) return undefined;
  const literal = extractLiteralAny(val);
  if (typeof val['path'] === 'string') {
    const boundPath = normalizeBindingPath(val['path'], ctx);
    recordInitializer(boundPath, literal, ctx);
    return {path: boundPath};
  }
  if (literal !== undefined) return literal;
  if (typeof val['call'] === 'string') return val;
  return undefined;
}

function normalizeChildList(
  val: unknown,
  ctx: NormalizeContext,
): string[] | {componentId: string; path: string} {
  if (Array.isArray(val)) {
    return val.filter((item): item is string => typeof item === 'string');
  }
  if (isRecord(val)) {
    if (Array.isArray(val['explicitList'])) {
      return val['explicitList'].filter((item): item is string => typeof item === 'string');
    }
    if (isRecord(val['template'])) {
      const tmpl = val['template'];
      const componentId = typeof tmpl['componentId'] === 'string' ? tmpl['componentId'] : '';
      const rawPath =
        typeof tmpl['dataBinding'] === 'string'
          ? tmpl['dataBinding']
          : typeof tmpl['path'] === 'string'
            ? tmpl['path']
            : '/';
      return {componentId, path: normalizeBindingPath(rawPath, ctx)};
    }
    if (typeof val['componentId'] === 'string' && typeof val['path'] === 'string') {
      return {
        componentId: val['componentId'],
        path: normalizeBindingPath(val['path'], ctx),
      };
    }
  }
  return [];
}

function normalizeIconName(compId: string, rawName: unknown, ctx: NormalizeContext): unknown {
  if (isRecord(rawName) && typeof rawName['svgPath'] === 'string') {
    return {svgPath: rawName['svgPath']};
  }
  const unwrapped = unwrapDynamicString(rawName, ctx);
  if (isRecord(unwrapped)) {
    return unwrapped;
  }
  const literal = typeof unwrapped === 'string' ? unwrapped : 'info';
  if (V09_ICON_NAMES.has(literal)) {
    return literal;
  }
  const override = ICON_OVERRIDES_REVERSE[literal];
  if (override && V09_ICON_NAMES.has(override)) {
    return override;
  }
  const camelCase = literal.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
  if (V09_ICON_NAMES.has(camelCase)) {
    return camelCase;
  }

  let iconKey = UNSAFE_KEYS.has(compId) || !compId ? `icon_${compId || 'default'}` : compId;
  const collidesWithExisting = (key: string): boolean =>
    Boolean(
      ctx.existingIconRecord &&
      Object.hasOwn(ctx.existingIconRecord, key) &&
      ctx.existingIconRecord[key] !== literal,
    ) ||
    (ctx.iconBindings.has(key) && ctx.iconBindings.get(key) !== literal);

  if (collidesWithExisting(iconKey)) {
    let counter = 1;
    while (collidesWithExisting(`${iconKey}_${counter}`)) {
      counter++;
    }
    iconKey = `${iconKey}_${counter}`;
  }

  ctx.iconBindings.set(iconKey, literal);
  return {path: `/${ICON_DATA_KEY}/${escapeJsonPointerSegment(iconKey)}`};
}

function normalizeButtonAction(rawAction: unknown, ctx: NormalizeContext): Record<string, unknown> {
  if (typeof rawAction === 'string') {
    return {event: {name: rawAction}};
  }
  if (isRecord(rawAction)) {
    if (isRecord(rawAction['event'])) {
      const ev = rawAction['event'];
      const name = typeof ev['name'] === 'string' ? ev['name'] : 'action';
      if (isRecord(ev['context'])) {
        const mappedContext: Record<string, unknown> = {};
        let hasEntries = false;
        for (const [k, v] of Object.entries(ev['context'])) {
          const resolved = unwrapDynamicValue(v, ctx);
          if (resolved !== undefined) {
            setSafeProp(mappedContext, k, resolved);
            hasEntries = true;
          }
        }
        return hasEntries ? {event: {name, context: mappedContext}} : {event: {name}};
      }
      return {event: {name}};
    }
    if (isRecord(rawAction['functionCall'])) {
      return {functionCall: rawAction['functionCall']};
    }
    const name = typeof rawAction['name'] === 'string' ? rawAction['name'] : 'action';
    const rawCtx = rawAction['context'];
    const mappedContext: Record<string, unknown> = {};
    let hasEntries = false;
    if (Array.isArray(rawCtx)) {
      for (const entry of rawCtx) {
        if (isRecord(entry) && typeof entry['key'] === 'string') {
          const resolved = unwrapDynamicValue(entry['value'], ctx);
          if (resolved !== undefined) {
            setSafeProp(mappedContext, entry['key'], resolved);
            hasEntries = true;
          }
        }
      }
    } else if (isRecord(rawCtx)) {
      for (const [k, v] of Object.entries(rawCtx)) {
        const resolved = unwrapDynamicValue(v, ctx);
        if (resolved !== undefined) {
          setSafeProp(mappedContext, k, resolved);
          hasEntries = true;
        }
      }
    }
    return hasEntries ? {event: {name, context: mappedContext}} : {event: {name}};
  }
  return {event: {name: 'action'}};
}

function normalizeV08Component(
  id: string,
  type: string,
  props: Record<string, unknown>,
  weight: number | undefined,
  ctx: NormalizeContext,
): V09Component {
  const base: V09Component = {
    id,
    component: type === 'MultipleChoice' ? 'ChoicePicker' : type,
  };
  if (weight !== undefined) {
    base['weight'] = weight;
  }

  switch (type) {
    case 'Text': {
      base['text'] = unwrapDynamicString(props['text'], ctx) ?? '';
      const hint = props['usageHint'] ?? props['variant'];
      if (typeof hint === 'string' && TEXT_VARIANTS.has(hint)) {
        base['variant'] = hint;
      }
      return base;
    }
    case 'Image': {
      base['url'] = unwrapDynamicString(props['url'], ctx) ?? '';
      const desc = unwrapDynamicString(props['altText'] ?? props['description'], ctx);
      if (desc !== undefined) base['description'] = desc;
      const rawFit = props['fit'] === 'scale-down' ? 'scaleDown' : props['fit'];
      if (typeof rawFit === 'string' && IMAGE_FITS.has(rawFit)) {
        base['fit'] = rawFit;
      }
      const hint = props['usageHint'] ?? props['variant'];
      if (typeof hint === 'string' && IMAGE_VARIANTS.has(hint)) {
        base['variant'] = hint;
      }
      return base;
    }
    case 'Icon': {
      base['name'] = normalizeIconName(id, props['name'], ctx);
      return base;
    }
    case 'Video': {
      base['url'] = unwrapDynamicString(props['url'], ctx) ?? '';
      return base;
    }
    case 'AudioPlayer': {
      base['url'] = unwrapDynamicString(props['url'], ctx) ?? '';
      const desc = unwrapDynamicString(props['description'], ctx);
      if (desc !== undefined) base['description'] = desc;
      return base;
    }
    case 'Row':
    case 'Column': {
      base['children'] = normalizeChildList(props['children'], ctx);
      const justify = props['distribution'] ?? props['justify'];
      if (typeof justify === 'string' && FLEX_JUSTIFY.has(justify)) {
        base['justify'] = justify;
      }
      const align = props['alignment'] ?? props['align'];
      if (typeof align === 'string' && FLEX_ALIGN.has(align)) {
        base['align'] = align;
      }
      return base;
    }
    case 'List': {
      base['children'] = normalizeChildList(props['children'], ctx);
      if (typeof props['direction'] === 'string' && LIST_DIRECTIONS.has(props['direction'])) {
        base['direction'] = props['direction'];
      }
      const align = props['alignment'] ?? props['align'];
      if (typeof align === 'string' && FLEX_ALIGN.has(align)) {
        base['align'] = align;
      }
      if (typeof props['listStyle'] === 'string' && LIST_STYLES.has(props['listStyle'])) {
        base['listStyle'] = props['listStyle'];
      }
      return base;
    }
    case 'Card': {
      base['child'] = typeof props['child'] === 'string' ? props['child'] : '';
      return base;
    }
    case 'Tabs': {
      const rawTabs = Array.isArray(props['tabItems'])
        ? props['tabItems']
        : Array.isArray(props['tabs'])
          ? props['tabs']
          : [];
      const mappedTabs = rawTabs.filter(isRecord).map(tab => ({
        title: unwrapDynamicString(tab['title'], ctx) ?? '',
        child: typeof tab['child'] === 'string' ? tab['child'] : '',
      }));
      if (mappedTabs.length === 0) {
        const emptyFallback: V09Component = {id, component: 'Column', children: []};
        if (weight !== undefined) emptyFallback['weight'] = weight;
        return emptyFallback;
      }
      base['tabs'] = mappedTabs;
      return base;
    }
    case 'Modal': {
      base['trigger'] =
        typeof props['entryPointChild'] === 'string'
          ? props['entryPointChild']
          : typeof props['trigger'] === 'string'
            ? props['trigger']
            : '';
      base['content'] =
        typeof props['contentChild'] === 'string'
          ? props['contentChild']
          : typeof props['content'] === 'string'
            ? props['content']
            : '';
      return base;
    }
    case 'Divider': {
      if (typeof props['axis'] === 'string' && DIVIDER_AXES.has(props['axis'])) {
        base['axis'] = props['axis'];
      }
      return base;
    }
    case 'Button': {
      base['child'] = typeof props['child'] === 'string' ? props['child'] : '';
      if (typeof props['variant'] === 'string' && BUTTON_VARIANTS.has(props['variant'])) {
        base['variant'] = props['variant'];
      } else if (props['primary'] === true) {
        base['variant'] = 'primary';
      } else if (props['primary'] === false) {
        base['variant'] = 'default';
      }
      base['action'] = normalizeButtonAction(props['action'], ctx);
      return base;
    }
    case 'CheckBox': {
      base['label'] = unwrapDynamicString(props['label'], ctx) ?? '';
      base['value'] = unwrapDynamicBoolean(props['value'], ctx) ?? false;
      return base;
    }
    case 'TextField': {
      base['label'] = unwrapDynamicString(props['label'], ctx) ?? '';
      const value = unwrapDynamicString(props['text'] ?? props['value'], ctx);
      if (value !== undefined) base['value'] = value;
      const rawType = props['textFieldType'] ?? props['variant'];
      if (rawType === 'date') {
        base['variant'] = 'shortText';
      } else if (typeof rawType === 'string' && TEXTFIELD_VARIANTS.has(rawType)) {
        base['variant'] = rawType;
      }
      if (typeof props['validationRegexp'] === 'string') {
        base['validationRegexp'] = props['validationRegexp'];
      }
      return base;
    }
    case 'DateTimeInput': {
      base['value'] = unwrapDynamicString(props['value'], ctx) ?? '';
      if (typeof props['enableDate'] === 'boolean') {
        base['enableDate'] = props['enableDate'];
      } else if (props['enableTime'] === true) {
        base['enableDate'] = true;
      }
      if (typeof props['enableTime'] === 'boolean') {
        base['enableTime'] = props['enableTime'];
      }
      const label = unwrapDynamicString(props['label'], ctx);
      if (label !== undefined) base['label'] = label;
      const min = unwrapDynamicString(props['min'], ctx);
      if (min !== undefined) base['min'] = min;
      const max = unwrapDynamicString(props['max'], ctx);
      if (max !== undefined) base['max'] = max;
      return base;
    }
    case 'MultipleChoice':
    case 'ChoicePicker': {
      const label = unwrapDynamicString(props['label'] ?? props['description'], ctx);
      if (label !== undefined) base['label'] = label;
      const rawOptions = Array.isArray(props['options']) ? props['options'] : [];
      base['options'] = rawOptions.filter(isRecord).map(opt => ({
        label: unwrapDynamicString(opt['label'], ctx) ?? '',
        value: typeof opt['value'] === 'string' ? opt['value'] : String(opt['value'] ?? ''),
      }));
      const boundSelections = unwrapDynamicStringList(props['selections'] ?? props['value'], ctx);
      if (
        !ctx.inTemplate &&
        isRecord(boundSelections) &&
        typeof boundSelections['path'] === 'string'
      ) {
        ctx.stringListPaths.push(boundSelections['path']);
      }
      base['value'] = boundSelections ?? [];
      if (typeof props['variant'] === 'string' && CHOICE_VARIANTS.has(props['variant'])) {
        base['variant'] = props['variant'];
      } else if (typeof props['maxAllowedSelections'] === 'number') {
        base['variant'] =
          props['maxAllowedSelections'] === 1 ? 'mutuallyExclusive' : 'multipleSelection';
      } else if (type === 'MultipleChoice') {
        base['variant'] = 'multipleSelection';
      }
      if (
        typeof props['displayStyle'] === 'string' &&
        CHOICE_DISPLAY_STYLES.has(props['displayStyle'])
      ) {
        base['displayStyle'] = props['displayStyle'];
      } else if (
        typeof props['variant'] === 'string' &&
        CHOICE_DISPLAY_STYLES.has(props['variant'])
      ) {
        base['displayStyle'] = props['variant'];
      }
      if (typeof props['filterable'] === 'boolean') {
        base['filterable'] = props['filterable'];
      }
      return base;
    }
    case 'Slider': {
      const label = unwrapDynamicString(props['label'], ctx);
      if (label !== undefined) base['label'] = label;
      base['value'] = unwrapDynamicNumber(props['value'], ctx) ?? 0;
      const min =
        typeof props['minValue'] === 'number'
          ? props['minValue']
          : typeof props['min'] === 'number'
            ? props['min']
            : undefined;
      if (min !== undefined) base['min'] = min;
      base['max'] =
        typeof props['maxValue'] === 'number'
          ? props['maxValue']
          : typeof props['max'] === 'number'
            ? props['max']
            : 100;
      return base;
    }
    default: {
      return {...props, ...base};
    }
  }
}

/**
 * Remaps a custom `root` component ID to `'root'` for v0.9 surfaces while avoiding
 * ID collisions when another component in the list is already named `'root'`.
 */
export function remapRootComponent(root: string, components: V09Component[]): V09Component[] {
  if (root === 'root') {
    return components;
  }

  const existingIds = new Set(components.map(c => c.id));
  const hasDeclaredRoot = Boolean(root) && existingIds.has(root);
  const hasLiteralRoot = existingIds.has('root');

  if (!hasDeclaredRoot && !hasLiteralRoot) {
    return components;
  }

  const idMap = new Map<string, string>();
  if (hasDeclaredRoot) {
    idMap.set(root, 'root');
  }
  if (hasLiteralRoot) {
    let displacedId = '__displaced_root';
    let counter = 1;
    while (existingIds.has(displacedId)) {
      displacedId = `__displaced_root_${counter++}`;
    }
    idMap.set('root', displacedId);
  }

  const mapId = (id: unknown): unknown =>
    typeof id === 'string' && idMap.has(id) ? idMap.get(id)! : id;

  return components.map(comp => {
    const mapped: V09Component = {...comp, id: mapId(comp.id) as string};
    for (const refKey of ['child', 'trigger', 'content']) {
      if (typeof mapped[refKey] === 'string') {
        mapped[refKey] = mapId(mapped[refKey]);
      }
    }
    if (Array.isArray(mapped['children'])) {
      mapped['children'] = mapped['children'].map(mapId);
    } else if (
      isRecord(mapped['children']) &&
      typeof mapped['children']['componentId'] === 'string'
    ) {
      mapped['children'] = {
        ...mapped['children'],
        componentId: mapId(mapped['children']['componentId']),
      };
    }
    if (Array.isArray(mapped['tabs'])) {
      mapped['tabs'] = mapped['tabs'].map(tab =>
        isRecord(tab) && typeof tab['child'] === 'string'
          ? {...tab, child: mapId(tab['child'])}
          : tab,
      );
    }
    return mapped;
  });
}

/**
 * Normalizes v0.8 component definitions and template data maps into v0.9 surface inputs.
 * Flat v0.9 components pass through with non-enum Material Icon ligatures bound via data model.
 */
export function normalizeV08Surface({
  root,
  components,
  data = EMPTY_DATA,
}: {
  root: string;
  components: A2UIComponent[];
  data?: Record<string, unknown>;
}): NormalizedSurfaceInput {
  const preparedComponents = separateSharedTemplateNodes(root, components);
  const {scopeByComponentId, normalizedData: templateNormalizedData} = buildTemplateScopesAndData(
    preparedComponents,
    data,
  );

  let normalizedData = templateNormalizedData;
  const existingIconRecord =
    Object.hasOwn(normalizedData, ICON_DATA_KEY) && isRecord(normalizedData[ICON_DATA_KEY])
      ? (normalizedData[ICON_DATA_KEY] as Record<string, unknown>)
      : null;

  const iconBindings = new Map<string, string>();
  const initializers: Array<{path: string; value: unknown}> = [];
  const stringListPaths: string[] = [];

  const normalizedComponents: V09Component[] = preparedComponents.map(comp => {
    const scope = scopeByComponentId.get(comp.id);
    const ctx: NormalizeContext = {
      inTemplate: scope !== undefined,
      itemKeys: scope ? scope.itemKeys : EMPTY_STRING_SET,
      rootData: normalizedData,
      existingIconRecord,
      iconBindings,
      initializers,
      stringListPaths,
    };

    const env = extractV08Envelope(comp);
    if (!env) {
      const compType = typeof comp['component'] === 'string' ? (comp['component'] as string) : '';
      if (compType === 'Icon' && comp['name'] !== undefined) {
        return {
          ...comp,
          component: 'Icon',
          name: normalizeIconName(comp.id, comp['name'], ctx),
        };
      }
      return {
        ...comp,
        component: compType,
      };
    }

    return normalizeV08Component(comp.id, env.type, env.props, env.weight, ctx);
  });

  for (const rawListPath of stringListPaths) {
    const segs = splitJsonPointer(rawListPath);
    if (segs.length === 0) continue;
    const existing = getAtSegments(normalizedData, segs);
    if (isRecord(existing)) {
      const arr = Object.values(existing).filter((v): v is string => typeof v === 'string');
      normalizedData = setAtSegmentsImmutable(normalizedData, segs, arr);
    }
  }

  for (const init of initializers) {
    const segs = splitJsonPointer(init.path);
    if (segs.length === 0) continue;
    if (getAtSegments(normalizedData, segs) === undefined) {
      normalizedData = setAtSegmentsImmutable(normalizedData, segs, init.value);
    }
  }

  if (iconBindings.size > 0) {
    const mergedIcons: Record<string, unknown> = existingIconRecord ? {...existingIconRecord} : {};
    for (const [key, literal] of iconBindings.entries()) {
      setSafeProp(mergedIcons, key, literal);
    }
    normalizedData = setAtSegmentsImmutable(normalizedData, [ICON_DATA_KEY], mergedIcons);
  }

  return {
    root: 'root',
    components: remapRootComponent(root, normalizedComponents),
    data: normalizedData,
  };
}
