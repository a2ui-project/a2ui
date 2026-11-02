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
import {CatalogApi, RendererCapabilities} from '../internal/web-core.js';
import {CatalogConfig} from '../processor/catalog-config.js';
import {catalogFromDocument} from '../processor/catalog-providers.js';
import {toWireProtocolVersion} from './protocol-version.js';

const ENTRY_FIELDS = ['supportedCatalogIds', 'inlineCatalogs'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
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
 * catalog of its own when the agent accepts inline catalogs, and is dropped otherwise.
 * Inline catalogs are not transformed, since transformers belong to a registration.
 * Every inline catalog is built, so a malformed one is an error even when the agent does
 * not accept inline catalogs.
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
    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
      throw new A2uiCatalogError('Each entry in inlineCatalogs must be a catalog object');
    }
    return catalogFromDocument(
      document as Record<string, unknown>,
      'inline catalog',
      key === 'v0.9' ? 'v0.9' : undefined,
    );
  });

  const active: CatalogApi[] = [];
  for (const id of (entry.supportedCatalogIds as string[] | undefined) ?? []) {
    const match = agentCatalogs.find(c => c.id === id);
    if (match && !active.includes(match)) {
      active.push(match);
    }
  }

  if (acceptsInlineCatalogs) {
    active.push(...inlineCatalogs);
  }

  if (active.length === 0) {
    throw new A2uiCatalogError(
      'No catalog in common with the renderer: it names no catalog the agent holds and ' +
        'declares no inline catalog the agent accepts.',
    );
  }
  return active;
}
