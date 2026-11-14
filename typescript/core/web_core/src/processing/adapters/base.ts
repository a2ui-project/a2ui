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

import {InternalOperation} from '../operations.js';
import {A2uiConfigurationError, A2uiValidationError} from '../../errors.js';
import {formatIssue, pickIssue} from '../../schema-engine/issues.js';
import type {A2uiIssue, JsonSchemaValidator} from '../../schema-engine/types.js';
import {extractEnvelopeErrorContext, mapErrorToRendererMessage} from '../message-error-mapper.js';
import {type ProtocolMessageSpec, validateProtocolMessage} from './message-specs.js';
import {SemVer, normalizeVersionString, toSemVer, toCanonicalVersion} from '../../common/semver.js';

/**
 * Union of supported A2UI protocol version strings.
 */
export type ProtocolVersion = 'v0.8' | 'v0.9' | 'v0.9.1' | '1.0' | (string & {});

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
 * @return Whether the catalog version is compatible with the message version.
 */
export function isCatalogVersionCompatible(
  catalogVersion: string | SemVer | undefined | null,
  messageVersion: string | SemVer | undefined | null,
  compatibilityMap: Readonly<Record<string, ReadonlySet<string>>> = DEFAULT_CATALOG_COMPATIBILITY,
): boolean {
  if (!catalogVersion || !messageVersion) {
    return false;
  }
  const catalogCanonical = toCanonicalVersion(catalogVersion);
  const messageCanonical = toCanonicalVersion(messageVersion);
  if (catalogCanonical && messageCanonical) {
    if (catalogCanonical === messageCanonical) {
      return true;
    }
    const compatible = compatibilityMap[messageCanonical];
    if (compatible && compatible.has(catalogCanonical)) {
      return true;
    }
    // For SemVer >= 1.0.0, releases within the same major version are compatible,
    // ignoring pre-release identifiers.
    const catalogSemver = toSemVer(catalogVersion);
    const messageSemver = toSemVer(messageVersion);
    if (
      catalogSemver &&
      messageSemver &&
      catalogSemver.major >= 1 &&
      catalogSemver.major === messageSemver.major
    ) {
      return true;
    }
    return false;
  }
  // Fallback for non-semver custom identifiers (e.g. 'custom' vs 'Vcustom')
  if (typeof catalogVersion !== 'string' || typeof messageVersion !== 'string') {
    return false;
  }
  const normalizedCatalog = normalizeVersionString(catalogVersion);
  const normalizedMessage = normalizeVersionString(messageVersion);
  return normalizedCatalog.length > 0 && normalizedCatalog === normalizedMessage;
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
   * @return Whether the catalog version is compatible.
   */
  isCatalogCompatible?(catalogVersion: string | SemVer | undefined | null): boolean;

  /**
   * Converts a raw message payload or payload list into canonical internal operations.
   *
   * @param payload The raw JSON message payload or message array.
   * @param options Optional validation configuration options.
   * @returns Array of canonical internal operations.
   */
  extractOperations(
    payload: unknown,
    options?: {allowUnknownElements?: boolean},
  ): InternalOperation[];
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
        const msg = 'surfaceId must be a string';
        throw new A2uiValidationError(
          msg,
          [{path: `/${key}/surfaceId`, code: 'type_mismatch', message: msg}],
          'VALIDATION_ERROR',
          {path: '/surfaceId'},
        );
      }
    }
  }
}

const PROPERTY_KEYWORDS = new Set(['additionalProperties', 'unevaluatedProperties']);

/**
 * Drops the issues that only say the message is not one of the other actions'
 * `oneOf` branches, leaving those about the action the message holds.
 */
function scopeIssuesToAction(issues: A2uiIssue[], actionKey: string): A2uiIssue[] {
  const scoped = issues.filter(
    i =>
      !(
        (i.path.length === 0 && (i.keyword === 'oneOf' || i.keyword === 'anyOf')) ||
        (i.path.length === 1 && i.keyword === 'required' && i.path[0] !== actionKey) ||
        (i.path.length === 1 &&
          i.path[0] === actionKey &&
          i.keyword !== undefined &&
          PROPERTY_KEYWORDS.has(i.keyword))
      ),
  );
  return scoped.length > 0 ? scoped : issues;
}

/** The RFC 6901 pointer to an issue, relative to the action's payload. */
function issuePointer(path: (string | number)[], actionKey: string): string {
  const segments = path[0] === actionKey ? path.slice(1) : path;
  return '/' + segments.map(s => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

/**
 * Base abstract class providing common payload unwrapping, schema validation,
 * and error formatting for protocol version adapters.
 */
export abstract class BaseVersionAdapter implements VersionAdapter {
  abstract readonly version: ProtocolVersion;
  /** The spec documents this version's messages are validated against. */
  protected abstract readonly messageSpec: ProtocolMessageSpec;

  /**
   * @param validator The JSON Schema validator messages are checked with.
   *   Required to extract operations; without one, only version resolution
   *   and the action key queries work.
   */
  constructor(protected readonly validator?: JsonSchemaValidator) {}

  /** Canonical catalog protocol versions compatible with this adapter. */
  get compatibleCatalogVersions(): ReadonlySet<string> {
    const canonical = toCanonicalVersion(this.version);
    return canonical ? new Set([canonical]) : new Set();
  }

  /** Set of valid message action keys supported by this protocol version. */
  get validActions(): ReadonlySet<string> {
    return new Set(this.getNativeActionKeys());
  }

  /** Checks if a catalog protocol version is compatible with this adapter. */
  isCatalogCompatible(catalogVersion: string | SemVer | undefined | null): boolean {
    if (!catalogVersion) {
      return false;
    }
    return isCatalogVersionCompatible(catalogVersion, this.version);
  }

  protected abstract getNativeActionKeys(): string[];

  extractOperations(
    payload: unknown,
    options?: {allowUnknownElements?: boolean},
  ): InternalOperation[] {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) {
      return payload.flatMap(item => this.extractOperations(item, options));
    }
    const msgObj = payload as Record<string, unknown>;
    if (Array.isArray(msgObj.messages)) {
      return this.extractOperations(msgObj.messages, options);
    }

    const nativeActionKeys = this.getNativeActionKeys();
    validateActionSurfaceIds(msgObj, nativeActionKeys);

    const presentNativeKeys = nativeActionKeys.filter(k => Object.hasOwn(msgObj, k)).sort();

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
        const msg = `Invalid ${this.version} message: action '${otherAction}' is not supported in protocol version ${this.version}. Allowed actions: ${sortedAllowed}.`;
        throw new A2uiValidationError(
          msg,
          [{path: '/version', code: 'invalid_value', message: msg}],
          'VALIDATION_ERROR',
          {path: '/version'},
        );
      }
      throw new A2uiValidationError(
        `Invalid ${this.version} message: message must contain exactly one update action: ${sortedAllowed}.`,
      );
    }

    const preparedPayload = this.preparePayloadForValidation(msgObj, options);
    if (!this.validator) {
      throw new A2uiConfigurationError(
        `The ${this.version} version adapter has no JsonSchemaValidator. Pass one in MessageProcessorOptions.validator, or to the adapter or VersionAdapterFactory constructor.`,
      );
    }
    const issues = validateProtocolMessage(this.validator, this.messageSpec, preparedPayload);
    if (issues.length > 0) {
      const actionKey = presentNativeKeys[0];
      const issue = pickIssue(scopeIssuesToAction(issues, actionKey));
      const err = new A2uiValidationError(
        `Invalid ${this.version} message: ${formatIssue(issue)}`,
        issues,
        'VALIDATION_ERROR',
        {path: issuePointer(issue.path, actionKey)},
      );
      const mapped = mapErrorToRendererMessage(
        err,
        extractEnvelopeErrorContext(msgObj, this.version),
      );
      err.surfaceId = mapped.error.surfaceId || undefined;
      err.functionCallId = mapped.error.functionCallId;
      throw err;
    }

    return this.extractOperationsFromObject(preparedPayload);
  }

  /**
   * Normalizes the message object before running schema validation.
   *
   * Defaults to attaching `version` if not present.
   *
   * @param msgObj Raw message object.
   * @param _options Optional validation configuration options.
   * @returns Normalized message payload for schema validation.
   */
  protected preparePayloadForValidation(
    msgObj: Record<string, unknown>,
    _options?: {allowUnknownElements?: boolean},
  ): Record<string, unknown> {
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
