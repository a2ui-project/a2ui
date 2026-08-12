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

import {A2uiProtocolVersion, AgentToRendererMessage} from '../../schema/index.js';
import {VersionAdapter} from './base.js';
import {VersionAdapterV09} from './v0_9.js';
import {VersionAdapterV10} from './v1_0.js';

/**
 * Static factory for resolving version adapters by protocol version.
 */
export class VersionAdapterFactory {
  private static readonly v09Adapter = new VersionAdapterV09();
  private static readonly v10Adapter = new VersionAdapterV10();

  /**
   * Returns the VersionAdapter for the specified protocol version.
   *
   * @param version The protocol version string or enum value.
   * @returns The corresponding VersionAdapter instance.
   */
  static getAdapter(version: A2uiProtocolVersion | string): VersionAdapter {
    switch (version) {
      case A2uiProtocolVersion.V0_8:
      case A2uiProtocolVersion.V0_9:
      case A2uiProtocolVersion.V0_9_1:
      case 'v0.8':
      case 'v0.9':
      case 'v0.9.1':
        return VersionAdapterFactory.v09Adapter;
      case A2uiProtocolVersion.V1_0:
      case 'v1.0':
        return VersionAdapterFactory.v10Adapter;
      default:
        throw new Error(`Unsupported A2UI protocol version: ${version}`);
    }
  }

  /**
   * Returns the VersionAdapter for the given message based on its version property.
   *
   * @param message The agent-to-renderer message payload.
   * @returns The corresponding VersionAdapter instance.
   */
  static getAdapterForMessage(message: AgentToRendererMessage): VersionAdapter {
    if (!message || typeof message !== 'object') {
      return VersionAdapterFactory.v09Adapter;
    }
    return VersionAdapterFactory.getAdapter(message.version);
  }
}
