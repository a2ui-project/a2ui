/**
 * @license
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

import {ResponsePart} from '../../parser/response_part.js';
import {SchemaCatalog} from '../../types.js';

/**
 * Options for configuring the Direct JSON stream processor.
 */
export interface DirectJsonStreamProcessorOptions {
  /**
   * Keys for which partial JSON string values should be emitted progressively.
   * If provided, the healer will attempt to cut and emit string values under these keys
   * before the containing JSON object is complete.
   */
  progressiveKeys?: string[];
  /**
   * If true, skips envelope schema validation on inbound server-to-client message envelopes.
   */
  disableValidation?: boolean;
}

/**
 * Interface for incrementally processing streamed Direct JSON chunks.
 *
 * Phase 2B will implement this contract in `streaming.ts`.
 * The design deliberately omits a flush/end method because state resets natively
 * upon encountering `</a2ui-json>`, and an abruptly dying stream rightfully drops
 * buffered partials that can never become valid JSON.
 */
export interface DirectJsonStreamProcessor {
  /**
   * Processes a chunk of text incrementally.
   *
   * @param chunk The next text chunk from the model.
   * @returns An array of response parts processed so far in the stream.
   */
  processChunk(chunk: string): ResponsePart[];
}

/**
 * Factory for creating stream processor instances.
 */
export interface DirectJsonStreamProcessorFactory {
  /**
   * Creates a new stream processor for the given catalog.
   */
  createStreamProcessor(
    catalog: SchemaCatalog,
    options?: DirectJsonStreamProcessorOptions,
  ): DirectJsonStreamProcessor;
}
