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
import {CatalogApi} from '../../internal/web-core.js';
import {checkParserCatalogs} from '../../utils/catalog-checks.js';
import {DirectJsonParser} from './parser.js';
import {DirectJsonExamples, DirectJsonPromptGenerator} from './prompt-generator.js';

/** The keys whose string values a Direct JSON stream heals unless the format names others. */
const DEFAULT_PROGRESSIVE_KEYS: readonly string[] = ['text'];

/** Options for the Direct JSON format. */
export interface DirectJsonFormatOptions {
  /**
   * Keys whose string values a stream closes where they stand while they arrive, so a long
   * text is emitted as it grows. Defaults to `['text']`. Pass an empty list to emit each
   * message only once its values have arrived whole.
   */
  progressiveKeys?: Iterable<string>;
  /**
   * Whether a pre-v1.0 stream holds back incomplete components until their JSON object
   * closes rather than healing them as they arrive. Components of v1.0+ catalogs are always
   * held back regardless of this setting.
   */
  bufferIncompleteComponents?: boolean;
}

/**
 * Direct JSON format implementation.
 */
export class DirectJsonFormat implements InferenceFormat {
  readonly promptGenerator: DirectJsonPromptGenerator;

  private readonly progressiveKeys: readonly string[];
  private readonly bufferIncompleteComponents: boolean;

  constructor(
    private readonly catalogs: CatalogApi[],
    examples?: DirectJsonExamples,
    options: DirectJsonFormatOptions = {},
  ) {
    checkParserCatalogs(catalogs);
    this.progressiveKeys = [...(options.progressiveKeys ?? DEFAULT_PROGRESSIVE_KEYS)];
    this.bufferIncompleteComponents = options.bufferIncompleteComponents ?? false;
    this.promptGenerator = new DirectJsonPromptGenerator(catalogs, examples);
  }

  createParser(): DirectJsonParser {
    return new DirectJsonParser(this.catalogs, {
      progressiveKeys: this.progressiveKeys,
      bufferIncompleteComponents: this.bufferIncompleteComponents,
    });
  }
}

/**
 * Factory for creating DirectJsonFormat instances.
 */
export class DirectJsonFormatFactory implements InferenceFormatFactory {
  constructor(private readonly options: DirectJsonFormatOptions = {}) {}

  createFormat(catalogs: CatalogApi[], examples?: DirectJsonExamples): InferenceFormat {
    return new DirectJsonFormat(catalogs, examples, this.options);
  }
}
