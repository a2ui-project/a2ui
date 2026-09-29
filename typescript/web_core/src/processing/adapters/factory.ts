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

import {A2uiValidationError} from '../../errors.js';
import {normalizeVersionString, toCanonicalVersion} from '../../common/semver.js';
import {
  ProtocolVersion,
  VersionAdapter,
  VersionAdapterResolver,
  registerKnownActionsProvider,
} from './base.js';
import {V0Point8Adapter} from './v0_8.js';
import {V0Point9Adapter} from './v0_9.js';
import {V1Point0Adapter} from './v1_0.js';

/**
 * Resolves version adapters for protocol specification versions.
 */
export class VersionAdapterFactory implements VersionAdapterResolver {
  private readonly adapters = new Map<string, VersionAdapter>([
    ['0.8', new V0Point8Adapter()],
    ['0.9', new V0Point9Adapter()],
    ['0.9.1', new V0Point9Adapter()],
    ['1.0', new V1Point0Adapter()],
  ]);

  /**
   * Returns the aggregated set of all action keys supported by all registered adapters.
   *
   * @return A set of all supported action key strings.
   */
  getAllKnownActions(): ReadonlySet<string> {
    const actions = new Set<string>();
    for (const adapter of this.adapters.values()) {
      if (adapter.validActions) {
        for (const action of adapter.validActions) {
          actions.add(action);
        }
      }
    }
    return actions;
  }

  /**
   * Dynamically registers a version adapter on this factory instance.
   *
   * @param adapter The version adapter instance to register.
   */
  registerAdapter(adapter: VersionAdapter): void {
    const key = toCanonicalVersion(adapter.version) ?? normalizeVersionString(adapter.version);
    this.adapters.set(key, adapter);
  }

  /**
   * Resolves the version adapter for the specified version string from this factory instance.
   *
   * @param version The protocol version string (e.g. 'v1.0').
   * @return The matching version adapter.
   * @throws A2uiValidationError if the version string is unsupported.
   */
  getAdapter(version: ProtocolVersion | string): VersionAdapter {
    const key = toCanonicalVersion(version) ?? normalizeVersionString(version);
    const adapter = this.adapters.get(key);
    if (!adapter) {
      const supported = Array.from(
        new Set(Array.from(this.adapters.keys()).map(k => (k.startsWith('v') ? k : `v${k}`))),
      )
        .sort()
        .join(', ');
      throw new A2uiValidationError(
        `[VersionAdapterFactory] Unsupported protocol version '${version}'. Supported versions: ${supported}.`,
      );
    }
    return adapter;
  }

  /**
   * Resolves the version adapter directly from an incoming message payload using this factory instance.
   *
   * @param payload The raw JSON message payload.
   * @returns The resolved version adapter.
   * @throws A2uiValidationError if the payload is missing a valid 'version' string.
   */
  resolveFromPayload(payload: unknown): VersionAdapter {
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (typeof item === 'object' && item !== null) {
      if ('messages' in item && Array.isArray((item as any).messages)) {
        return this.resolveFromPayload((item as any).messages);
      }
      if ('version' in item) {
        const ver = (item as {version: unknown}).version;
        if (typeof ver !== 'string') {
          throw new A2uiValidationError(
            `[VersionAdapterFactory] Message payload is missing a valid 'version' string: 'version' property must be a string, got ${typeof ver}.`,
          );
        }
        return this.getAdapter(ver);
      }
      if (
        'beginRendering' in item ||
        'surfaceUpdate' in item ||
        'dataModelUpdate' in item ||
        'deleteSurface' in item
      ) {
        return this.getAdapter('v0.8');
      }
    }
    throw new A2uiValidationError(
      "[VersionAdapterFactory] Message payload is missing a valid 'version' string.",
    );
  }

  /**
   * Registers a version adapter on the default singleton factory instance.
   *
   * @param adapter Version adapter instance to register.
   */
  static registerAdapter(adapter: VersionAdapter): void {
    defaultVersionAdapterFactory.registerAdapter(adapter);
  }

  /**
   * Resolves a version adapter for the specified version from the default singleton factory instance.
   *
   * @param version Protocol version string.
   * @return Matching version adapter.
   */
  static getAdapter(version: ProtocolVersion | string): VersionAdapter {
    return defaultVersionAdapterFactory.getAdapter(version);
  }

  /**
   * Resolves a version adapter directly from a payload using the default singleton factory instance.
   *
   * @param payload Raw JSON message payload.
   * @returns Resolved version adapter.
   */
  static resolveFromPayload(payload: unknown): VersionAdapter {
    return defaultVersionAdapterFactory.resolveFromPayload(payload);
  }

  /**
   * Returns the aggregated set of all action keys supported by all registered adapters
   * from the default singleton factory instance.
   *
   * @return A set of all supported action key strings.
   */
  static getAllKnownActions(): ReadonlySet<string> {
    return defaultVersionAdapterFactory.getAllKnownActions();
  }
}

/** Default singleton version adapter factory instance. */
export const defaultVersionAdapterFactory = new VersionAdapterFactory();
registerKnownActionsProvider(() => defaultVersionAdapterFactory.getAllKnownActions());
