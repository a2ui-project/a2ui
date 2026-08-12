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

/**
 * Surface properties extracted from an agent-to-renderer message payload.
 */
export interface SurfaceProperties {
  /** Unique surface identifier. */
  surfaceId: string;
  /** Catalog identifier for component and function resolution. */
  catalogId?: string;
  /** Theme parameters for the surface. */
  theme?: any;
  /** Whether full data model reporting is enabled for this surface. */
  sendDataModel?: boolean;
  /** Additional surface metadata. */
  metadata?: any;
}

/**
 * Initial component and data model state extracted from a message payload.
 */
export interface InitialState {
  /** Component definitions array. */
  components?: any[];
  /** Data model object. */
  dataModel?: Record<string, any>;
}

/**
 * Interface defining protocol version adapter methods to isolate minor
 * differences across protocol specifications.
 */
export interface VersionAdapter {
  /** The protocol version supported by this adapter. */
  readonly version: A2uiProtocolVersion;

  /**
   * Extracts surface properties from an agent-to-renderer message.
   *
   * @param message The agent-to-renderer message payload.
   * @returns Extracted surface properties, or undefined if not applicable.
   */
  extractSurfaceProperties(message: AgentToRendererMessage): SurfaceProperties | undefined;

  /**
   * Extracts initial component and data model state from a message payload.
   *
   * @param message The agent-to-renderer message payload.
   * @returns Extracted initial state, or undefined if not applicable.
   */
  extractInitialState(message: AgentToRendererMessage): InitialState | undefined;

  /**
   * Extracts the message type discriminator key (e.g. 'createSurface', 'updateComponents').
   *
   * @param message The agent-to-renderer message payload.
   * @returns The message type name string.
   */
  extractMessageType(message: AgentToRendererMessage): string;

  /**
   * Normalizes an agent-to-renderer message into a standard structure.
   *
   * @param message The raw agent-to-renderer message payload.
   * @returns The normalized message object.
   */
  normalizeMessage(message: AgentToRendererMessage): AgentToRendererMessage;
}
