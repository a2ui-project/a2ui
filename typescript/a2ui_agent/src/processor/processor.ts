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

import {SchemaCatalog} from '../types.js';
import {
  AgentToRendererMessage,
  MessageProcessor,
  Catalog,
  ComponentApi,
  FunctionImplementation,
} from '../internal/web_core.js';
import {InferenceFormatFactory, InferenceFormat} from '../inference_format/base.js';
import {ResponsePart} from '../parser/response_part.js';
import {DirectJsonFormatFactory} from '../inference_formats/direct_json/format.js';
import {Parser} from '../parser/parser.js';
import {toWireProtocolVersion} from '../utils/protocol_version.js';

/** Request-scoped facade over the negotiated catalogs, prompt, parser, and validation. */
export class A2uiRequestProcessor {
  private readonly _format: InferenceFormat;
  private readonly _parser: Parser;
  private readonly _messageProcessor: MessageProcessor;

  constructor(
    private readonly catalogs: SchemaCatalog[],
    private readonly _examples?: Record<string, AgentToRendererMessage[]>,
    formatFactory?: InferenceFormatFactory,
  ) {
    const factory = formatFactory || new DirectJsonFormatFactory();
    this._format = factory.createFormat(catalogs, _examples);
    this._parser = this._format.createParser();

    // TEMPORARY: MessageProcessor in web_core enforces Catalog<any, FunctionImplementation>
    // even though it doesn't execute functions when initialized without an actionHandler.
    // TODO(web_core): Relax the generic constraint on MessageProcessor or allow omitting FunctionImplementation.
    this._messageProcessor = new MessageProcessor(
      catalogs as unknown as Catalog<ComponentApi, FunctionImplementation>[],
      undefined,
      {version: toWireProtocolVersion(catalogs[0]?.protocolVersion)},
    );
  }

  /** The negotiated catalogs active for this request. */
  get activeCatalogs(): SchemaCatalog[] {
    return this.catalogs;
  }

  get examples(): Record<string, AgentToRendererMessage[]> | undefined {
    return this._examples;
  }

  /**
   * Format-specific system prompt snippet to feed the model.
   *
   * Equivalent to `generate()` with defaults, kept as a property because the module
   * blueprint declares `prompt_snippet` that way. Callers wanting role, workflow, or UI
   * descriptions reach the full `PromptGenerator.generate(options)` through the format.
   */
  get promptSnippet(): string {
    return this._format.promptGenerator.generate();
  }

  /** Parses and validates a model response. */
  parseResponse(content: string): ResponsePart[] {
    const parts = this._parser.parseResponse(content);

    for (const part of parts) {
      if (part.type === 'a2ui') {
        this._messageProcessor.processMessages(part.a2ui);
      }
    }

    return parts;
  }
}
