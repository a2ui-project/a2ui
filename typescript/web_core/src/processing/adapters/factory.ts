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
import {ProtocolVersion, VersionAdapter, VersionAdapterResolver} from './base.js';
import {V0Point8Adapter} from './v0_8.js';
import {V0Point9Adapter} from './v0_9.js';
import {V1Point0Adapter} from './v1_0.js';

/**
 * Resolves version adapters for protocol specification versions.
 */
export class VersionAdapterFactory implements VersionAdapterResolver {
  private readonly adapters = new Map<string, VersionAdapter>([
    ['v0.8', new V0Point8Adapter()],
    ['v0.9', new V0Point9Adapter()],
    ['v0.9.1', new V0Point9Adapter()],
    ['v1.0', new V1Point0Adapter()],
  ]);

  /**
   * Dynamically registers a version adapter on this factory instance.
   *
   * @param adapter The version adapter instance to register.
   */
  registerAdapter(adapter: VersionAdapter): void {
    this.adapters.set(adapter.version, adapter);
  }

  /**
   * Resolves the version adapter for the specified version string from this factory instance.
   *
   * @param version The protocol version string (e.g. 'v1.0').
   * @returns The matching version adapter.
   * @throws A2uiValidationError if the version string is unsupported.
   */
  getAdapter(version: ProtocolVersion | string): VersionAdapter {
    const adapter = this.adapters.get(version);
    if (!adapter) {
      const supported = Array.from(this.adapters.keys()).join(', ');
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
      if ('version' in item && typeof (item as {version: unknown}).version === 'string') {
        return this.getAdapter((item as {version: string}).version);
      }
      if ('beginRendering' in item || 'surfaceUpdate' in item || 'dataModelUpdate' in item) {
        return this.getAdapter('v0.8');
      }
    }
    throw new A2uiValidationError(
      "[VersionAdapterFactory] Message payload is missing a valid 'version' string.",
    );
  }

  /**
   * Static convenience method: registers a version adapter on the default singleton instance.
   */
  static registerAdapter(adapter: VersionAdapter): void {
    defaultVersionAdapterFactory.registerAdapter(adapter);
  }

  /**
   * Static convenience method: resolves a version adapter from the default singleton instance.
   */
  static getAdapter(version: ProtocolVersion | string): VersionAdapter {
    return defaultVersionAdapterFactory.getAdapter(version);
  }

  /**
   * Static convenience method: resolves a version adapter from payload using the default singleton instance.
   */
  static resolveFromPayload(payload: unknown): VersionAdapter {
    return defaultVersionAdapterFactory.resolveFromPayload(payload);
  }
}

export const defaultVersionAdapterFactory = new VersionAdapterFactory();
