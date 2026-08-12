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
import {InitialState, SurfaceProperties, VersionAdapter} from './base.js';

/**
 * Protocol version adapter implementation for A2UI v0.9 and v0.9.1 specifications.
 */
export class VersionAdapterV09 implements VersionAdapter {
  readonly version = A2uiProtocolVersion.V0_9;

  /**
   * Extracts surface properties from a v0.9 message payload.
   *
   * @param message The agent-to-renderer message payload.
   * @returns Extracted surface properties, or undefined if not applicable.
   */
  extractSurfaceProperties(message: AgentToRendererMessage): SurfaceProperties | undefined {
    const msg = message as any;
    if ('createSurface' in msg) {
      return {
        surfaceId: msg.createSurface.surfaceId,
        catalogId: msg.createSurface.catalogId,
        theme: msg.createSurface.theme,
        sendDataModel: msg.createSurface.sendDataModel,
      };
    }
    if ('updateComponents' in msg) {
      return {surfaceId: msg.updateComponents.surfaceId};
    }
    if ('updateDataModel' in msg) {
      return {surfaceId: msg.updateDataModel.surfaceId};
    }
    if ('deleteSurface' in msg) {
      return {surfaceId: msg.deleteSurface.surfaceId};
    }
    return undefined;
  }

  /**
   * Extracts initial state from a v0.9 message payload.
   *
   * @param message The agent-to-renderer message payload.
   * @returns Extracted initial state, or undefined if not applicable.
   */
  extractInitialState(message: AgentToRendererMessage): InitialState | undefined {
    const msg = message as any;
    if ('createSurface' in msg) {
      return {components: undefined, dataModel: undefined};
    }
    if ('updateComponents' in msg) {
      return {components: msg.updateComponents.components};
    }
    if ('updateDataModel' in msg) {
      const path = msg.updateDataModel.path || '/';
      return {dataModel: {[path]: msg.updateDataModel.value}};
    }
    return undefined;
  }

  /**
   * Extracts the message type discriminator key.
   *
   * @param message The agent-to-renderer message payload.
   * @returns The message type string.
   */
  extractMessageType(message: AgentToRendererMessage): string {
    const msg = message as any;
    if ('createSurface' in msg) return 'createSurface';
    if ('updateComponents' in msg) return 'updateComponents';
    if ('updateDataModel' in msg) return 'updateDataModel';
    if ('deleteSurface' in msg) return 'deleteSurface';
    return 'unknown';
  }

  /**
   * Normalizes a v0.9 message.
   *
   * @param message The raw agent-to-renderer message payload.
   * @returns The normalized message object.
   */
  normalizeMessage(message: AgentToRendererMessage): AgentToRendererMessage {
    return message;
  }
}
