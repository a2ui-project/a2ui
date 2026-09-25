/*
 * Copyright 2026 Google LLC
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

/**
 * @fileoverview Format definition and factory for A2UI Express DSL.
 */

import {InferenceFormat, InferenceFormatFactory} from '../../inference_format/base.js';
import {SchemaCatalog} from '../../types.js';
import {AgentToRendererMessage} from '../../internal/web_core.js';
import {resolveExpressVersion, toCatalogList} from './catalogs.js';
import {Parser} from '../../parser/parser.js';
import {ExpressParser} from './parser.js';
import {ExpressPromptGenerator} from './prompt_generator.js';

export interface ExpressFormatOptions {
  surfaceId?: string;
  version?: string;
  examples?: Record<string, AgentToRendererMessage[] | string>;
}

/**
 * Express inference format implementation.
 */
export class ExpressFormat implements InferenceFormat {
  readonly promptGenerator: ExpressPromptGenerator;
  readonly supportsStreaming = false;
  private readonly catalogs: SchemaCatalog[];
  private readonly surfaceId: string;
  private readonly version: string;

  constructor(catalogs: SchemaCatalog[], options: ExpressFormatOptions = {}) {
    this.catalogs = toCatalogList(catalogs);
    this.surfaceId = options.surfaceId ?? 'main';
    this.version = resolveExpressVersion(this.catalogs, options.version);

    this.promptGenerator = new ExpressPromptGenerator(this.catalogs, options.examples);
  }

  createParser(): Parser {
    return new ExpressParser(this.catalogs, this.surfaceId, this.version);
  }
}

/**
 * Factory for creating ExpressFormat instances.
 */
export class ExpressFormatFactory implements InferenceFormatFactory {
  constructor(
    private readonly options: {
      surfaceId?: string;
      version?: string;
    } = {},
  ) {}

  createFormat(
    catalogs: SchemaCatalog[],
    examples?: Record<string, AgentToRendererMessage[] | string>,
  ): InferenceFormat {
    return new ExpressFormat(catalogs, {
      ...this.options,
      examples,
    });
  }
}
