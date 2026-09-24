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

import {SchemaCatalog} from '../types.js';
import {Parser} from '../parser/parser.js';
import {PromptGenerator} from '../prompt/generator.js';
import {AgentToRendererMessage} from '../internal/web_core.js';

/**
 * Encapsulates format-specific prompt generation and response parsing logic.
 */
export interface InferenceFormat {
  readonly promptGenerator: PromptGenerator;

  /**
   * Whether parsers created by this format support streaming. Mirrors Python InferenceFormat.supports_streaming.
   */
  readonly supportsStreaming: boolean;

  /**
   * Creates a parser tied to this inference format.
   */
  createParser(): Parser;
}

/**
 * Factory for creating InferenceFormat instances bound to the negotiated catalogs.
 */
export interface InferenceFormatFactory {
  /**
   * Creates a new inference format instance.
   *
   * @param catalogs The negotiated active catalogs for this session.
   * @param examples Optional few-shot examples for prompt generation.
   */
  createFormat(
    catalogs: SchemaCatalog[],
    examples?: Record<string, AgentToRendererMessage[]>,
  ): InferenceFormat;
}
