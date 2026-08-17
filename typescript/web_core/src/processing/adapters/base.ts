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

/**
 * Union of supported A2UI protocol version strings.
 */
export type ProtocolVersion = 'v0.8' | 'v0.9' | 'v0.9.1' | 'v1.0' | (string & {});

/**
 * Isolates protocol syntax differences across specification versions.
 */
export interface VersionAdapter {
  /** The protocol version string supported by this adapter (e.g. 'v1.0'). */
  readonly version: ProtocolVersion;

  /**
   * Converts a raw message payload or payload list into canonical internal operations.
   *
   * @param payload The raw JSON message payload or message array.
   * @returns Array of canonical internal operations.
   */
  extractOperations(payload: unknown): InternalOperation[];
}
