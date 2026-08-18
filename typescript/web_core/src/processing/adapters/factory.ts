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
import {ProtocolVersion, VersionAdapter} from './base.js';
import {V0_8VersionAdapter} from './v0_8.js';
import {V0_9VersionAdapter} from './v0_9.js';
import {V1_0VersionAdapter} from './v1_0.js';

/**
 * Resolves version adapters for protocol specification versions.
 */
export class VersionAdapterFactory {
  private static adapters = new Map<string, VersionAdapter>([
    ['v0.8', new V0_8VersionAdapter()],
    ['v0.9', new V0_9VersionAdapter()],
    ['v0.9.1', new V0_9VersionAdapter()],
    ['v1.0', new V1_0VersionAdapter()],
  ]);

  /**
   * Dynamically registers a version adapter.
   *
   * @param adapter The version adapter instance to register.
   */
  static registerAdapter(adapter: VersionAdapter): void {
    VersionAdapterFactory.adapters.set(adapter.version, adapter);
  }

  /**
   * Resolves the version adapter for the specified version string.
   *
   * @param version The protocol version string (e.g. 'v1.0').
   * @returns The matching version adapter.
   * @throws A2uiValidationError if the version string is unsupported.
   */
  static getAdapter(version: ProtocolVersion | string): VersionAdapter {
    const adapter = VersionAdapterFactory.adapters.get(version);
    if (!adapter) {
      const supported = Array.from(VersionAdapterFactory.adapters.keys()).join(', ');
      throw new A2uiValidationError(
        `[VersionAdapterFactory] Unsupported protocol version '${version}'. Supported versions: ${supported}.`,
      );
    }
    return adapter;
  }

  /**
   * Resolves the version adapter directly from an incoming message payload.
   *
   * @param payload The raw JSON message payload.
   * @returns The resolved version adapter.
   * @throws A2uiValidationError if the payload is missing a valid 'version' string.
   */
  static resolveFromPayload(payload: unknown): VersionAdapter {
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (typeof item === 'object' && item !== null) {
      if ('messages' in item && Array.isArray((item as any).messages)) {
        return VersionAdapterFactory.resolveFromPayload((item as any).messages);
      }
      if ('version' in item && typeof (item as {version: unknown}).version === 'string') {
        return VersionAdapterFactory.getAdapter((item as {version: string}).version);
      }
    }
    throw new A2uiValidationError(
      "[VersionAdapterFactory] Message payload is missing a valid 'version' string.",
    );
  }

  getAdapter(version: ProtocolVersion | string): VersionAdapter {
    return VersionAdapterFactory.getAdapter(version);
  }

  resolveFromPayload(payload: unknown): VersionAdapter {
    return VersionAdapterFactory.resolveFromPayload(payload);
  }
}

export const defaultVersionAdapterFactory = new VersionAdapterFactory();
