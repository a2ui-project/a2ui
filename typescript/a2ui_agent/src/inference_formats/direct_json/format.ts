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

import {InferenceFormat, InferenceFormatFactory} from '../../inference-format.js';
import {SchemaCatalog} from '../../types.js';
import {AgentToRendererMessage} from '../../internal/web_core.js';
import {Parser} from '../../parser/parser.js';
import {DirectJsonParser} from './parser.js';
import {DirectJsonPromptGenerator} from './prompt_generator.js';

/**
 * Direct JSON format implementation.
 */
export class DirectJsonFormat implements InferenceFormat {
  readonly promptGenerator: DirectJsonPromptGenerator;
  readonly supportsStreaming = false;

  constructor(
    private readonly catalogs: SchemaCatalog[],
    examples?: Record<string, AgentToRendererMessage[] | string>,
  ) {
    this.promptGenerator = new DirectJsonPromptGenerator(catalogs, examples);
  }

  createParser(): Parser {
    return new DirectJsonParser(this.catalogs[0]);
  }
}

/**
 * Factory for creating DirectJsonFormat instances.
 */
export class DirectJsonFormatFactory implements InferenceFormatFactory {
  createFormat(
    catalogs: SchemaCatalog[],
    examples?: Record<string, AgentToRendererMessage[] | string>,
  ): InferenceFormat {
    if (catalogs.length === 0) {
      throw new Error('At least one catalog must be provided to create a DirectJsonFormat.');
    }
    return new DirectJsonFormat(catalogs, examples);
  }
}
