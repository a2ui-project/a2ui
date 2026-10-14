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
import {AgentToRendererMessage, CatalogApi, STRICT_VALIDATION} from '../../internal/web-core.js';
import {Parser} from '../../parser/parser.js';
import {DirectJsonParser} from './parser.js';
import {DirectJsonPromptGenerator} from './prompt-generator.js';
import {checkParserCatalogs} from '../../utils/validation.js';
import {DirectJsonStreamProcessorImpl} from './streaming.js';
import {
  DirectJsonStreamProcessorFactory,
  DirectJsonStreamProcessorOptions,
} from './streaming-types.js';

/**
 * Direct JSON format implementation.
 */
export class DirectJsonFormat implements InferenceFormat {
  readonly promptGenerator: DirectJsonPromptGenerator;
  // createParser always injects a stream processor.
  readonly supportsStreaming = true;

  constructor(
    private readonly catalogs: CatalogApi[],
    examples?: Record<string, AgentToRendererMessage[] | string>,
    private readonly streamProcessorFactory?: DirectJsonStreamProcessorFactory,
    private readonly streamOptions?: DirectJsonStreamProcessorOptions,
  ) {
    checkParserCatalogs(catalogs);
    this.promptGenerator = new DirectJsonPromptGenerator(catalogs, examples);
  }

  createParser(): Parser {
    const streamProcessor = this.streamProcessorFactory
      ? this.streamProcessorFactory.createStreamProcessor(this.catalogs, this.streamOptions)
      : new DirectJsonStreamProcessorImpl(
          this.catalogs,
          this.streamOptions || {
            progressiveKeys: ['text', 'literalString'],
            validationConfig: STRICT_VALIDATION,
          },
        );

    return new DirectJsonParser(this.catalogs, streamProcessor);
  }
}

/**
 * Factory for creating DirectJsonFormat instances.
 */
export class DirectJsonFormatFactory implements InferenceFormatFactory {
  constructor(
    private readonly streamProcessorFactory?: DirectJsonStreamProcessorFactory,
    private readonly streamOptions?: DirectJsonStreamProcessorOptions,
  ) {}

  createFormat(
    catalogs: CatalogApi[],
    examples?: Record<string, AgentToRendererMessage[] | string>,
  ): InferenceFormat {
    if (catalogs.length === 0) {
      throw new Error('At least one catalog must be provided to create a DirectJsonFormat.');
    }
    return new DirectJsonFormat(
      catalogs,
      examples,
      this.streamProcessorFactory,
      this.streamOptions,
    );
  }
}
