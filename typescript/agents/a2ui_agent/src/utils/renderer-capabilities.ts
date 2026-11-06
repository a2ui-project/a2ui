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

import {A2uiCatalogError} from '../errors.js';
import {RendererCapabilities} from '../internal/web-core.js';
import {catalogFromDocument} from '../processor/catalog-providers.js';
import {ProtocolVersion} from '../types.js';
import {toWireProtocolVersion} from './protocol-version.js';

/** Transport metadata key for v0.8 and v0.9 client capabilities. */
export const A2UI_CLIENT_CAPABILITIES_KEY = 'a2uiClientCapabilities';

/** Transport metadata key for v1.0+ renderer capabilities. */
export const A2UI_RENDERER_CAPABILITIES_KEY = 'a2uiRendererCapabilities';

const ALLOWED_ENTRY_KEYS = new Set(['supportedCatalogIds', 'inlineCatalogs']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateCapabilitiesEntry(
  entry: Record<string, unknown>,
  entryKey: string,
  metadataKey: string,
  wireVersion: ProtocolVersion,
): RendererCapabilities {
  for (const key of Object.keys(entry)) {
    if (!ALLOWED_ENTRY_KEYS.has(key)) {
      throw new A2uiCatalogError(
        `Unknown property '${key}' in '${entryKey}' renderer capabilities under '${metadataKey}'.`,
      );
    }
  }

  const rawIds = Object.hasOwn(entry, 'supportedCatalogIds')
    ? entry.supportedCatalogIds
    : undefined;
  if (!Array.isArray(rawIds) || !rawIds.every((id): id is string => typeof id === 'string')) {
    throw new A2uiCatalogError(
      `The 'supportedCatalogIds' field in '${entryKey}' renderer capabilities under '${metadataKey}' must be an array of strings.`,
    );
  }

  let inlineCatalogs: Record<string, unknown>[] | undefined;
  if (Object.hasOwn(entry, 'inlineCatalogs') && entry.inlineCatalogs !== undefined) {
    const rawInline = entry.inlineCatalogs;
    if (!Array.isArray(rawInline)) {
      throw new A2uiCatalogError(
        `The 'inlineCatalogs' field in '${entryKey}' renderer capabilities under '${metadataKey}' must be an array of catalog objects.`,
      );
    }
    inlineCatalogs = [];
    for (const cat of rawInline) {
      if (!isRecord(cat) || typeof cat.catalogId !== 'string' || cat.catalogId.trim() === '') {
        throw new A2uiCatalogError(
          `Each inline catalog in '${entryKey}' renderer capabilities under '${metadataKey}' must be an object with a non-empty string 'catalogId'.`,
        );
      }
      catalogFromDocument(cat, 'inlineCatalogs', wireVersion);
      inlineCatalogs.push({...cat});
    }
  }

  return {
    supportedCatalogIds: [...rawIds],
    ...(inlineCatalogs !== undefined ? {inlineCatalogs} : {}),
  };
}

/**
 * Reads and validates renderer capabilities for `version` from transport `metadata`.
 *
 * Looks up `a2uiRendererCapabilities` for v1.0 and `a2uiClientCapabilities` for
 * v0.8, v0.9, and v0.9.1 (supporting both the `v0.8`-keyed and bare v0.8 forms).
 * Returns `undefined` when `metadata` is `null`/`undefined` or the version's
 * capabilities entry is absent, and throws `A2uiCatalogError` when the metadata
 * key or version entry is malformed.
 *
 * @param metadata The transport message metadata object, or `null`/`undefined`.
 * @param version The A2UI protocol version to read capabilities for.
 * @returns A version-keyed capabilities object accepted unchanged by `resolveCatalogs`,
 *     or `undefined` when absent.
 */
export function readRendererCapabilities(
  metadata: unknown,
  version: ProtocolVersion | string = '1.0',
): Record<string, RendererCapabilities> | undefined {
  let wireVersion: ProtocolVersion;
  try {
    wireVersion = toWireProtocolVersion(version);
  } catch (e) {
    throw new A2uiCatalogError(e instanceof Error ? e.message : String(e));
  }

  if (metadata === null || metadata === undefined) {
    return undefined;
  }
  if (!isRecord(metadata)) {
    throw new A2uiCatalogError('Transport metadata must be a JSON object.');
  }

  const metadataKey =
    wireVersion === '1.0' ? A2UI_RENDERER_CAPABILITIES_KEY : A2UI_CLIENT_CAPABILITIES_KEY;
  const raw = Object.hasOwn(metadata, metadataKey) ? metadata[metadataKey] : undefined;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isRecord(raw)) {
    throw new A2uiCatalogError(`The '${metadataKey}' metadata value must be a JSON object.`);
  }

  const entryKey = wireVersion === '1.0' ? '1.0' : wireVersion === 'v0.8' ? 'v0.8' : 'v0.9';
  let entry = Object.hasOwn(raw, entryKey) ? raw[entryKey] : undefined;
  if (
    (entry === undefined || entry === null) &&
    entryKey === 'v0.8' &&
    (Object.hasOwn(raw, 'supportedCatalogIds') || Object.hasOwn(raw, 'inlineCatalogs'))
  ) {
    entry = raw;
  }
  if (entry === undefined || entry === null) {
    return undefined;
  }
  if (!isRecord(entry)) {
    throw new A2uiCatalogError(
      `The '${entryKey}' capabilities entry under '${metadataKey}' must be a JSON object.`,
    );
  }

  const validatedEntry = validateCapabilitiesEntry(entry, entryKey, metadataKey, wireVersion);
  return {[entryKey]: validatedEntry};
}
