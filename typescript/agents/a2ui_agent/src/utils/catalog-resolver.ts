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

import {A2uiCatalogError, A2uiValidationError} from '../errors.js';
import {
  CatalogApi,
  isAtLeastVersion,
  RendererCapabilities,
  V09_STANDARD_DEFS,
  V10_STANDARD_DEFS,
} from '../internal/web-core.js';
import {CatalogConfig} from '../processor/catalog-config.js';
import {catalogFromDocument} from '../processor/catalog-providers.js';
import {toWireProtocolVersion} from './protocol-version.js';

const ENTRY_FIELDS = ['supportedCatalogIds', 'inlineCatalogs'] as const;
const ARRAY_INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
const INVALID_ESCAPE_RE = /~(?![01])/;
const LITERAL_VALUE_KEYWORDS = new Set(['const', 'default', 'enum', 'examples']);
const SCHEMA_COMPOSITE_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'not'] as const;
const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'components',
  'definitions',
  'dependencies',
  'dependentSchemas',
  'functions',
  'patternProperties',
  'properties',
  'styles',
]);
const PRE_V1_COMMON_TYPE_DEFS: ReadonlySet<string> = new Set(Object.keys(V09_STANDARD_DEFS));
const V1_0_COMMON_TYPE_DEFS: ReadonlySet<string> = new Set(Object.keys(V10_STANDARD_DEFS));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function commonTypeDefsForVersion(protocolVersion: string): ReadonlySet<string> {
  return isAtLeastVersion(protocolVersion, '1.0') ? V1_0_COMMON_TYPE_DEFS : PRE_V1_COMMON_TYPE_DEFS;
}

function followPointer(document: Record<string, unknown>, segments: string[]): unknown {
  let curr: unknown = document;
  for (const segment of segments) {
    if (isPlainObject(curr) && Object.hasOwn(curr, segment)) {
      curr = curr[segment];
    } else if (
      Array.isArray(curr) &&
      ARRAY_INDEX_RE.test(segment) &&
      segment.length <= String(curr.length).length &&
      Number(segment) < curr.length
    ) {
      curr = curr[Number(segment)];
    } else {
      return undefined;
    }
  }
  return curr;
}

function isResolvableLocalRef(
  document: Record<string, unknown>,
  ref: string,
  commonDefs: ReadonlySet<string>,
): boolean {
  if (ref === '#') {
    return true;
  }
  if (!ref.startsWith('#/')) {
    return false;
  }
  const rawTokens = ref.slice(2).split('/');
  if (rawTokens.some(token => INVALID_ESCAPE_RE.test(token))) {
    return false;
  }
  const segments = rawTokens.map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (isPlainObject(followPointer(document, segments))) {
    return true;
  }
  return segments.length === 2 && segments[0] === '$defs' && commonDefs.has(segments[1]);
}

function isFlatThemeMap(value: Record<string, unknown>): boolean {
  const rawRef = Object.hasOwn(value, '$ref') ? value['$ref'] : undefined;
  const rawType = Object.hasOwn(value, 'type') ? value['type'] : undefined;
  const rawProperties = Object.hasOwn(value, 'properties') ? value['properties'] : undefined;
  if (typeof rawRef === 'string') {
    return false;
  }
  if (typeof rawType === 'string' || Array.isArray(rawType)) {
    return false;
  }
  if (isPlainObject(rawProperties)) {
    return false;
  }
  return !SCHEMA_COMPOSITE_KEYWORDS.some(key => Object.hasOwn(value, key));
}

function isSchemaMapChild(
  parent: Record<string, unknown>,
  document: Record<string, unknown>,
  key: string,
  value: unknown,
): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  if (SCHEMA_MAP_KEYWORDS.has(key)) {
    return true;
  }
  return parent === document && key === 'theme' && isFlatThemeMap(value);
}

function enqueueObjectChildren(
  node: Record<string, unknown>,
  document: Record<string, unknown>,
  inSchemaMap: boolean,
  stack: Array<[unknown, boolean]>,
): void {
  if (inSchemaMap) {
    const values = Object.values(node);
    for (let i = values.length - 1; i >= 0; i--) {
      stack.push([values[i], false]);
    }
    return;
  }
  const entries = Object.entries(node);
  for (let i = entries.length - 1; i >= 0; i--) {
    const [key, value] = entries[i];
    if (!LITERAL_VALUE_KEYWORDS.has(key)) {
      stack.push([value, isSchemaMapChild(node, document, key, value)]);
    }
  }
}

/**
 * Asserts that every local `#...` `$ref` in an inline catalog document resolves.
 *
 * Allows `#/$defs/<CommonType>` pointers defined in the protocol version's
 * `common_types.json` so pre-1.0 inline catalogs emitted without `$defs` remain valid,
 * while rejecting undefined catalog-local pointers.
 */
export function assertResolvableInlineCatalogLocalRefs(
  document: Record<string, unknown>,
  catalogId: string,
  protocolVersion: string,
): void {
  const commonDefs = commonTypeDefsForVersion(protocolVersion);
  const stack: Array<[unknown, boolean]> = [[document, false]];
  while (stack.length > 0) {
    const [node, inSchemaMap] = stack.pop()!;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        stack.push([node[i], false]);
      }
      continue;
    }
    if (!isPlainObject(node)) {
      continue;
    }
    if (!inSchemaMap) {
      const ref = Object.hasOwn(node, '$ref') ? node['$ref'] : undefined;
      if (
        typeof ref === 'string' &&
        ref.startsWith('#') &&
        !isResolvableLocalRef(document, ref, commonDefs)
      ) {
        throw new A2uiCatalogError(
          `Inline catalog '${catalogId}' contains an unresolvable local $ref '${ref}'.`,
        );
      }
    }
    enqueueObjectChildren(node, document, inSchemaMap, stack);
  }
}

function capabilitiesKeyFor(catalog: CatalogApi): string {
  const wireVersion = toWireProtocolVersion(catalog.protocolVersion || '1.0');
  return wireVersion === 'v0.9.1' ? 'v0.9' : wireVersion;
}

function extractCapabilitiesEntry(
  rendererCapabilities: unknown,
  key: string,
): Record<string, unknown> {
  if (!isPlainObject(rendererCapabilities)) {
    throw new A2uiValidationError('Renderer capabilities must be an object.');
  }
  let entry: unknown = Object.hasOwn(rendererCapabilities, key)
    ? rendererCapabilities[key]
    : undefined;
  if (
    entry === undefined &&
    ENTRY_FIELDS.some(field => Object.hasOwn(rendererCapabilities, field))
  ) {
    entry = rendererCapabilities;
  }
  if (entry === undefined || entry === null) {
    throw new A2uiValidationError(
      `The renderer capabilities have no '${key}' entry, which the registered catalogs read.`,
    );
  }
  if (!isPlainObject(entry)) {
    throw new A2uiValidationError(
      `Invalid '${key}' renderer capabilities: entry must be an object.`,
    );
  }
  if (
    entry.supportedCatalogIds !== undefined &&
    (!Array.isArray(entry.supportedCatalogIds) ||
      !entry.supportedCatalogIds.every((id): id is string => typeof id === 'string'))
  ) {
    throw new A2uiValidationError(
      `Invalid '${key}' renderer capabilities: supportedCatalogIds must be an array of strings.`,
    );
  }
  return entry;
}

/**
 * Matches renderer capabilities against registered catalogs and returns the active,
 * transformed set for this session.
 *
 * Every registered catalog the renderer names becomes active, in the renderer's preference
 * order, so its first choice is the first catalog the model reads about. An id the agent
 * does not hold is ignored. Each inline catalog the renderer declares becomes an active
 * catalog of its own when the agent accepts inline catalogs, unless an active catalog
 * already has its id (in which case a warning is logged and the duplicate inline catalog is
 * dropped), and is dropped otherwise. Inline catalogs are not transformed, since
 * transformers belong to a registration. Every inline catalog is built and its local
 * `$ref`s checked, so a malformed one is an error even when the agent does not accept
 * inline catalogs.
 *
 * @param catalogs Registered catalog configurations supported by the agent.
 * @param rendererCapabilities Capabilities sent by the client renderer (either keyed by
 *     protocol version, such as `{"v1.0": {"supportedCatalogIds": [...]}}`, or a single
 *     capabilities entry), or `undefined` when the request carried none. With no
 *     capabilities the renderer stated no preference, so every registered catalog is
 *     active, which is none when nothing is registered.
 * @param acceptsInlineCatalogs Whether the agent accepts inline catalogs from the client.
 * @returns Array of active CatalogApi instances.
 * @throws {A2uiCatalogError} If capabilities are given and the agent has no catalogs, if
 *     registered catalogs read different capabilities keys, if `inlineCatalogs` is not an
 *     array of valid catalogs, or if negotiation leaves no active catalog.
 * @throws {A2uiValidationError} If the capabilities have no valid entry for the protocol
 *     version of the registered catalogs.
 */
export function resolveCatalogs(
  catalogs: CatalogConfig[],
  rendererCapabilities: Record<string, RendererCapabilities> | RendererCapabilities | undefined,
  acceptsInlineCatalogs = false,
): CatalogApi[] {
  const agentCatalogs = catalogs.map(c => c.transformedCatalog);
  if (!rendererCapabilities) {
    return agentCatalogs;
  }
  if (agentCatalogs.length === 0) {
    throw new A2uiCatalogError('Agent has no configured catalogs');
  }

  const key = capabilitiesKeyFor(agentCatalogs[0]);
  for (let i = 1; i < agentCatalogs.length; i++) {
    const catalog = agentCatalogs[i];
    const otherKey = capabilitiesKeyFor(catalog);
    if (otherKey !== key) {
      throw new A2uiCatalogError(
        `The registered catalogs read different capabilities entries: '${agentCatalogs[0].id}' reads '${key}' and '${catalog.id}' reads '${otherKey}'.`,
      );
    }
  }

  const entry = extractCapabilitiesEntry(rendererCapabilities, key);

  const inlineDocuments: unknown = entry.inlineCatalogs ?? [];
  if (!Array.isArray(inlineDocuments)) {
    throw new A2uiCatalogError('inlineCatalogs in the renderer capabilities must be an array');
  }
  const inlineCatalogs = inlineDocuments.map(document => {
    if (!isPlainObject(document)) {
      throw new A2uiCatalogError('Each entry in inlineCatalogs must be a catalog object');
    }
    const built = catalogFromDocument(
      document,
      'inline catalog',
      key === 'v0.9' ? 'v0.9' : undefined,
    );
    assertResolvableInlineCatalogLocalRefs(
      document,
      built.id,
      built.protocolVersion || (key === 'v0.9' ? 'v0.9' : '1.0'),
    );
    return built;
  });

  const active: CatalogApi[] = [];
  for (const id of (entry.supportedCatalogIds as string[] | undefined) ?? []) {
    const match = agentCatalogs.find(c => c.id === id);
    if (match && !active.includes(match)) {
      active.push(match);
    }
  }

  if (acceptsInlineCatalogs) {
    for (const inline of inlineCatalogs) {
      if (active.some(c => c.id === inline.id)) {
        console.warn(
          `Dropping inline catalog '${inline.id}': a catalog with this ID is already active.`,
        );
        continue;
      }
      active.push(inline);
    }
  }

  if (active.length === 0) {
    throw new A2uiCatalogError(
      'No catalog in common with the renderer: it names no catalog the agent holds and ' +
        'declares no inline catalog the agent accepts.',
    );
  }
  return active;
}
