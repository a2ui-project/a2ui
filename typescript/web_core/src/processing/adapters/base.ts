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
import {InternalOperation} from '../operations.js';
import {A2uiValidationError} from '../../errors.js';
import {formatZodIssue} from '../format-zod-issue.js';
import {SemVer, normalizeVersionString, toSemVer, toCanonicalVersion} from '../../common/semver.js';

/**
 * Union of supported A2UI protocol version strings.
 */
export type ProtocolVersion = 'v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0' | (string & {});

/**
 * Canonical protocol versions supported by the A2UI runtime.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  '0.8',
  '0.9',
  '0.9.1',
  '1.0',
]);

/**
 * Default explicit catalog-to-message protocol compatibility mapping.
 *
 * Maps an incoming message or surface protocol version to the set of catalog
 * protocol specification versions that it can accommodate.
 */
export const DEFAULT_CATALOG_COMPATIBILITY: Readonly<Record<string, ReadonlySet<string>>> = {
  '0.8': new Set(['0.8']),
  '0.9': new Set(['0.9', '0.9.1']),
  '0.9.1': new Set(['0.9.1', '0.9']),
  '1.0': new Set(['1.0']),
};

/**
 * Evaluates whether a catalog protocol version is compatible with an incoming message or surface version.
 *
 * Compatibility is verified against explicit supported version sets.
 * Minor formatting differences ('v1.0', '1.0', '1.0.0', 'v1_0') normalize to the same canonical version.
 *
 * @param catalogVersion The catalog's declared protocol version.
 * @param messageVersion The incoming message or surface declared protocol version.
 * @param compatibilityMap Optional explicit compatibility mapping. Defaults to DEFAULT_CATALOG_COMPATIBILITY.
 * @returns Whether the catalog version is compatible with the message version.
 */
export function isCatalogVersionCompatible(
  catalogVersion: string | SemVer | undefined | null,
  messageVersion: string | SemVer | undefined | null,
  compatibilityMap: Readonly<Record<string, ReadonlySet<string>>> = DEFAULT_CATALOG_COMPATIBILITY,
): boolean {
  if (!catalogVersion || !messageVersion) {
    return false;
  }
  const catCanonical = toCanonicalVersion(catalogVersion);
  const msgCanonical = toCanonicalVersion(messageVersion);
  if (catCanonical && msgCanonical) {
    if (catCanonical === msgCanonical) {
      return true;
    }
    const compatible = compatibilityMap[msgCanonical];
    if (compatible && compatible.has(catCanonical)) {
      return true;
    }
    // For SemVer >= 1.0.0, releases within the same major version are compatible
    const catSv = toSemVer(catalogVersion);
    const msgSv = toSemVer(messageVersion);
    if (
      catSv &&
      msgSv &&
      catSv.major >= 1 &&
      catSv.major === msgSv.major &&
      catSv.prerelease.length === 0 &&
      msgSv.prerelease.length === 0
    ) {
      return true;
    }
    return false;
  }
  // Fallback for non-semver custom identifiers (e.g. 'custom' vs 'Vcustom')
  if (typeof catalogVersion !== 'string' || typeof messageVersion !== 'string') {
    return false;
  }
  const normCat = normalizeVersionString(catalogVersion);
  const normMsg = normalizeVersionString(messageVersion);
  return normCat.length > 0 && normCat === normMsg;
}

/**
 * Resolves a version adapter for a given protocol version or raw payload.
 */
export interface VersionAdapterResolver {
  /** Resolves an adapter by protocol version string. */
  getAdapter(version: ProtocolVersion | string): VersionAdapter;
  /** Resolves an adapter from a raw message payload. */
  resolveFromPayload(payload: unknown): VersionAdapter;
}

/**
 * Isolates protocol syntax differences across specification versions.
 */
export interface VersionAdapter {
  /** Protocol version string supported by this adapter (e.g. 'v1.0'). */
  readonly version: ProtocolVersion;

  /** Set of canonical catalog protocol versions compatible with this adapter. */
  readonly compatibleCatalogVersions?: ReadonlySet<string>;

  /** Set of action keys supported by this version adapter. */
  readonly validActions?: ReadonlySet<string>;

  /**
   * Checks if a catalog protocol version is compatible with this adapter.
   *
   * @param catalogVersion The catalog's declared protocol version.
   * @returns Whether the catalog version is compatible.
   */
  isCatalogCompatible?(catalogVersion: string | SemVer | undefined | null): boolean;

  /**
   * Converts a raw message payload or payload list into canonical internal operations.
   *
   * @param payload The raw JSON message payload or message array.
   * @returns Array of canonical internal operations.
   */
  extractOperations(payload: unknown): InternalOperation[];
}

/** Provider callback returning the set of all known action keys across registered adapters. */
export type KnownActionsProvider = () => ReadonlySet<string>;

let globalKnownActionsProvider: KnownActionsProvider | undefined;

/**
 * Registers a provider callback to dynamically supply known action keys across adapters.
 *
 * @param provider Callback returning a ReadonlySet of all known action keys.
 */
export function registerKnownActionsProvider(provider: KnownActionsProvider): void {
  globalKnownActionsProvider = provider;
}

function validateActionSurfaceIds(
  msgObj: Record<string, unknown>,
  actionKeys: readonly string[],
): void {
  for (const key of actionKeys) {
    const actionVal = msgObj[key];
    if (actionVal && typeof actionVal === 'object') {
      const actionObj = actionVal as Record<string, unknown>;
      if (
        'surfaceId' in actionObj &&
        actionObj.surfaceId !== undefined &&
        typeof actionObj.surfaceId !== 'string'
      ) {
        throw new A2uiValidationError('surfaceId must be a string');
      }
    }
  }
}

/**
 * Base abstract class providing common payload unwrapping, schema validation,
 * and error formatting for protocol version adapters.
 */
export abstract class BaseVersionAdapter implements VersionAdapter {
  abstract readonly version: ProtocolVersion;
  protected abstract readonly schema: z.ZodTypeAny;

  get compatibleCatalogVersions(): ReadonlySet<string> {
    const canonical = toCanonicalVersion(this.version);
    return canonical ? new Set([canonical]) : new Set();
  }

  get validActions(): ReadonlySet<string> {
    return new Set(this.getNativeActionKeys());
  }

  isCatalogCompatible(catalogVersion: string | SemVer | undefined | null): boolean {
    if (!catalogVersion) {
      return false;
    }
    return isCatalogVersionCompatible(catalogVersion, this.version);
  }

  protected abstract getNativeActionKeys(): string[];

  extractOperations(payload: unknown): InternalOperation[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) {
      return payload.flatMap(item => this.extractOperations(item));
    }
    const msgObj = payload as Record<string, unknown>;
    if (Array.isArray(msgObj.messages)) {
      return this.extractOperations(msgObj.messages);
    }

    const nativeActionKeys = this.getNativeActionKeys();
    validateActionSurfaceIds(msgObj, nativeActionKeys);

    const presentNativeKeys = nativeActionKeys.filter(k => k in msgObj).sort();

    if (presentNativeKeys.length > 1) {
      throw new A2uiValidationError(
        `Message contains multiple conflicting update actions: ${presentNativeKeys.join(', ')}.`,
      );
    }

    if (presentNativeKeys.length === 0) {
      const allKnown = globalKnownActionsProvider
        ? globalKnownActionsProvider()
        : new Set(nativeActionKeys);
      const otherAction = Object.keys(msgObj).find(
        k => allKnown.has(k) && !nativeActionKeys.includes(k),
      );
      const sortedAllowed = nativeActionKeys.slice().sort().join(', ');
      if (otherAction) {
        throw new A2uiValidationError(
          `Invalid ${this.version} message: action '${otherAction}' is not supported in protocol version ${this.version}. Allowed actions: ${sortedAllowed}.`,
        );
      }
      throw new A2uiValidationError(
        `Invalid ${this.version} message: message must contain exactly one update action: ${sortedAllowed}.`,
      );
    }

    const preparedPayload = this.preparePayloadForValidation(msgObj);
    const parseResult = this.schema.safeParse(preparedPayload);
    if (!parseResult.success) {
      const formattedErrors = parseResult.error.errors.map(formatZodIssue).join('; ');
      throw new A2uiValidationError(
        `Invalid ${this.version} message: ${formattedErrors}`,
        parseResult.error,
      );
    }

    return this.extractOperationsFromObject(msgObj);
  }

  /**
   * Normalizes the message object before running schema validation.
   *
   * Defaults to attaching `version` if not present.
   *
   * @param msgObj Raw message object.
   * @returns Normalized message payload for schema validation.
   */
  protected preparePayloadForValidation(msgObj: Record<string, unknown>): Record<string, unknown> {
    return 'version' in msgObj ? msgObj : {version: this.version, ...msgObj};
  }

  /**
   * Converts a validated message object into canonical internal operations.
   *
   * @param msgObj Validated message payload.
   * @returns Array of canonical internal operations.
   */
  protected abstract extractOperationsFromObject(
    msgObj: Record<string, unknown>,
  ): InternalOperation[];
}
