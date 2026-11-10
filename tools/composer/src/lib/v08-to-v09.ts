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

interface DataBinding {
  path: string;
}

type DynamicScalar<T> = T | DataBinding;

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
    if (!isRecord(cur)) return undefined;
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
  if (rest.length === 0) {
    return {...obj, [head]: value};
  }
  const next = isRecord(obj[head]) ? (obj[head] as Record<string, unknown>) : {};
  return {...obj, [head]: setAtSegmentsImmutable(next, rest, value)};
}

function extractV08Envelope(
  comp: A2UIComponent,
): {type: string; props: Record<string, unknown>; weight?: number} | null {
  const weight = typeof comp['weight'] === 'number' ? (comp['weight'] as number) : undefined;
  const rawComp = comp['component'];
  if (typeof rawComp === 'string') {
    return null;
  }
  if (!isRecord(rawComp)) {
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

function collectV08ChildIds(props: Record<string, unknown>): string[] {
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
  } else if (isRecord(children)) {
    if (Array.isArray(children['explicitList'])) {
      for (const id of children['explicitList']) {
        if (typeof id === 'string' && id) ids.push(id);
      }
    }
    if (isRecord(children['template']) && typeof children['template']['componentId'] === 'string') {
      ids.push(children['template']['componentId'] as string);
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

function collectTemplateMetadata(components: A2UIComponent[]): {
  templateSubtreeIds: Set<string>;
  templateDataBindings: string[];
} {
  const childGraph = new Map<string, string[]>();
  const templateRoots: string[] = [];
  const templateDataBindings: string[] = [];

  for (const comp of components) {
    const env = extractV08Envelope(comp);
    const props = env ? env.props : comp;
    childGraph.set(comp.id, collectV08ChildIds(props));

    const children = props['children'];
    if (isRecord(children) && isRecord(children['template'])) {
      const tmpl = children['template'];
      if (typeof tmpl['componentId'] === 'string' && tmpl['componentId']) {
        templateRoots.push(tmpl['componentId']);
      }
      const binding = tmpl['dataBinding'] ?? tmpl['path'];
      if (typeof binding === 'string' && binding) {
        templateDataBindings.push(binding);
      }
    }
  }

  const templateSubtreeIds = new Set<string>();
  const queue = [...templateRoots];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (templateSubtreeIds.has(id)) continue;
    templateSubtreeIds.add(id);
    const kids = childGraph.get(id) ?? [];
    for (const kid of kids) {
      if (!templateSubtreeIds.has(kid)) {
        queue.push(kid);
      }
    }
  }

  return {templateSubtreeIds, templateDataBindings};
}

interface NormalizeContext {
  inTemplate: boolean;
  rootData: Record<string, unknown>;
  iconBindings: Record<string, string>;
}

function normalizeBindingPath(rawPath: string, ctx: NormalizeContext): string {
  if (!rawPath) return '/';
  if (ctx.inTemplate && rawPath.startsWith('/') && rawPath.length > 1) {
    const firstSeg = unescapeJsonPointerSegment(rawPath.slice(1).split('/')[0] ?? '');
    if (firstSeg && !Object.prototype.hasOwnProperty.call(ctx.rootData, firstSeg)) {
      return rawPath.slice(1);
    }
  }
  return rawPath;
}

function unwrapDynamicString(
  val: unknown,
  ctx: NormalizeContext,
): DynamicScalar<string> | undefined {
  if (typeof val === 'string') return val;
  if (!isRecord(val)) return undefined;
  if (typeof val['literalString'] === 'string') return val['literalString'];
  if (typeof val['stringValue'] === 'string') return val['stringValue'];
  if (typeof val['literal'] === 'string') return val['literal'];
  if (typeof val['path'] === 'string') {
    return {path: normalizeBindingPath(val['path'], ctx)};
  }
  return undefined;
}

function unwrapDynamicNumber(
  val: unknown,
  ctx: NormalizeContext,
): DynamicScalar<number> | undefined {
  if (typeof val === 'number') return val;
  if (!isRecord(val)) return undefined;
  if (typeof val['literalNumber'] === 'number') return val['literalNumber'];
  if (typeof val['numberValue'] === 'number') return val['numberValue'];
  if (typeof val['literal'] === 'number') return val['literal'];
  if (typeof val['path'] === 'string') {
    return {path: normalizeBindingPath(val['path'], ctx)};
  }
  return undefined;
}

function unwrapDynamicBoolean(
  val: unknown,
  ctx: NormalizeContext,
): DynamicScalar<boolean> | undefined {
  if (typeof val === 'boolean') return val;
  if (!isRecord(val)) return undefined;
  if (typeof val['literalBoolean'] === 'boolean') return val['literalBoolean'];
  if (typeof val['booleanValue'] === 'boolean') return val['booleanValue'];
  if (typeof val['literal'] === 'boolean') return val['literal'];
  if (typeof val['path'] === 'string') {
    return {path: normalizeBindingPath(val['path'], ctx)};
  }
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
  if (Array.isArray(val['literalArray'])) {
    return val['literalArray'].filter((item): item is string => typeof item === 'string');
  }
  if (typeof val['path'] === 'string') {
    return {path: normalizeBindingPath(val['path'], ctx)};
  }
  return undefined;
}

function unwrapDynamicValue(val: unknown, ctx: NormalizeContext): unknown {
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(item => unwrapDynamicValue(item, ctx));
  }
  if (!isRecord(val)) return undefined;
  if (typeof val['literalString'] === 'string') return val['literalString'];
  if (typeof val['stringValue'] === 'string') return val['stringValue'];
  if (typeof val['literalNumber'] === 'number') return val['literalNumber'];
  if (typeof val['numberValue'] === 'number') return val['numberValue'];
  if (typeof val['literalBoolean'] === 'boolean') return val['literalBoolean'];
  if (typeof val['booleanValue'] === 'boolean') return val['booleanValue'];
  if (Array.isArray(val['literalArray'])) return val['literalArray'];
  if (typeof val['path'] === 'string') {
    return {path: normalizeBindingPath(val['path'], ctx)};
  }
  return val;
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
  ctx.iconBindings[compId] = literal;
  return {path: `/${ICON_DATA_KEY}/${escapeJsonPointerSegment(compId)}`};
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
        for (const [k, v] of Object.entries(ev['context'])) {
          const resolved = unwrapDynamicValue(v, ctx);
          if (resolved !== undefined) mappedContext[k] = resolved;
        }
        return Object.keys(mappedContext).length > 0
          ? {event: {name, context: mappedContext}}
          : {event: {name}};
      }
      return {event: {name}};
    }
    if (isRecord(rawAction['functionCall'])) {
      return {functionCall: rawAction['functionCall']};
    }
    const name = typeof rawAction['name'] === 'string' ? rawAction['name'] : 'action';
    const rawCtx = rawAction['context'];
    const mappedContext: Record<string, unknown> = {};
    if (Array.isArray(rawCtx)) {
      for (const entry of rawCtx) {
        if (isRecord(entry) && typeof entry['key'] === 'string') {
          const resolved = unwrapDynamicValue(entry['value'], ctx);
          if (resolved !== undefined) {
            mappedContext[entry['key']] = resolved;
          }
        }
      }
    } else if (isRecord(rawCtx)) {
      for (const [k, v] of Object.entries(rawCtx)) {
        const resolved = unwrapDynamicValue(v, ctx);
        if (resolved !== undefined) {
          mappedContext[k] = resolved;
        }
      }
    }
    return Object.keys(mappedContext).length > 0
      ? {event: {name, context: mappedContext}}
      : {event: {name}};
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
      base['tabs'] = rawTabs.filter(isRecord).map(tab => ({
        title: unwrapDynamicString(tab['title'], ctx) ?? '',
        child: typeof tab['child'] === 'string' ? tab['child'] : '',
      }));
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
      if (typeof props['enableDate'] === 'boolean') base['enableDate'] = props['enableDate'];
      if (typeof props['enableTime'] === 'boolean') base['enableTime'] = props['enableTime'];
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
      const label = unwrapDynamicString(props['label'], ctx);
      if (label !== undefined) base['label'] = label;
      const rawOptions = Array.isArray(props['options']) ? props['options'] : [];
      base['options'] = rawOptions.filter(isRecord).map(opt => ({
        label: unwrapDynamicString(opt['label'], ctx) ?? '',
        value: typeof opt['value'] === 'string' ? opt['value'] : String(opt['value'] ?? ''),
      }));
      base['value'] = unwrapDynamicStringList(props['selections'] ?? props['value'], ctx) ?? [];
      if (typeof props['variant'] === 'string' && CHOICE_VARIANTS.has(props['variant'])) {
        base['variant'] = props['variant'];
      } else if (typeof props['maxAllowedSelections'] === 'number') {
        base['variant'] =
          props['maxAllowedSelections'] === 1 ? 'mutuallyExclusive' : 'multipleSelection';
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
  if (root === 'root' || !components.some(c => c.id === root)) {
    return components;
  }

  const existingIds = new Set(components.map(c => c.id));
  const idMap = new Map<string, string>([[root, 'root']]);

  if (existingIds.has('root')) {
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
 * Components already in v0.9 format (`typeof component === 'string'`) pass through unchanged.
 */
export function normalizeV08Surface({
  root,
  components,
  data = {},
}: {
  root: string;
  components: A2UIComponent[];
  data?: Record<string, unknown>;
}): NormalizedSurfaceInput {
  const {templateSubtreeIds, templateDataBindings} = collectTemplateMetadata(components);

  let normalizedData: Record<string, unknown> = data;
  for (const bindingPath of templateDataBindings) {
    const segments = splitJsonPointer(bindingPath);
    if (segments.length === 0) continue;
    const existing = getAtSegments(normalizedData, segments);
    if (isRecord(existing)) {
      normalizedData = setAtSegmentsImmutable(normalizedData, segments, Object.values(existing));
    }
  }

  const iconBindings: Record<string, string> = {};
  const normalizedComponents: V09Component[] = components.map(comp => {
    const env = extractV08Envelope(comp);
    if (!env) {
      return {
        ...comp,
        component: typeof comp['component'] === 'string' ? (comp['component'] as string) : 'Text',
      };
    }
    return normalizeV08Component(comp.id, env.type, env.props, env.weight, {
      inTemplate: templateSubtreeIds.has(comp.id),
      rootData: normalizedData,
      iconBindings,
    });
  });

  if (Object.keys(iconBindings).length > 0) {
    normalizedData = {
      ...normalizedData,
      [ICON_DATA_KEY]: iconBindings,
    };
  }

  return {
    root: 'root',
    components: remapRootComponent(root, normalizedComponents),
    data: normalizedData,
  };
}
