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

import {
  AgentToRendererMessage,
  Catalog,
  CatalogApi,
  ComponentApi,
  FunctionImplementation,
  MessageProcessor,
  type ValidationConfig,
} from '../internal/web-core.js';
import {InferenceFormatFactory, InferenceFormat} from '../inference-format.js';
import {ResponsePart} from '../parser/response-part.js';
import {DirectJsonFormatFactory} from '../inference-formats/direct-json/format.js';
import {Parser} from '../parser/parser.js';

/**
 * Validation applied to model output in `parseResponse`.
 *
 * Every component type and function call must be declared by the catalog it
 * resolves to (or be a reserved system function such as `@index`), so the
 * agent rejects model output that the renderer could not run. Topology is not
 * enforced: a response may legitimately update part of a surface, so a
 * missing root, orphans and references to components sent later are allowed.
 */
const MODEL_OUTPUT_VALIDATION: ValidationConfig = Object.freeze({
  allowUnknownElements: false,
  allowMissingRoot: true,
  allowOrphanComponents: true,
  allowDanglingReferences: true,
});

/** Request-scoped facade over the negotiated catalogs, prompt, parser, and validation. */
export class A2uiRequestProcessor {
  private readonly _format: InferenceFormat;
  private readonly _parser: Parser;
  private readonly _messageProcessor: MessageProcessor;

  constructor(
    private readonly catalogs: CatalogApi[],
    private readonly _examples?: Record<string, AgentToRendererMessage[] | string>,
    formatFactory?: InferenceFormatFactory,
  ) {
    const factory = formatFactory || new DirectJsonFormatFactory();
    this._format = factory.createFormat(catalogs, _examples);
    this._parser = this._format.createParser();

    // TEMPORARY: MessageProcessor in web_core enforces Catalog<any, FunctionImplementation>
    // even though it doesn't execute functions when initialized without an actionHandler.
    // TODO(web_core): Relax the generic constraint on MessageProcessor or allow omitting FunctionImplementation.
    //
    // No protocol version is configured: MessageProcessor picks the adapter for each message
    // from the message's own `version` field.
    this._messageProcessor = new MessageProcessor(
      catalogs as unknown as Catalog<ComponentApi, FunctionImplementation>[],
      undefined,
      {validationConfig: MODEL_OUTPUT_VALIDATION},
    );
  }

  /** The negotiated catalogs active for this request. */
  get activeCatalogs(): CatalogApi[] {
    return this.catalogs;
  }

  get examples(): Record<string, AgentToRendererMessage[] | string> | undefined {
    return this._examples;
  }

  /**
   * Format-specific system prompt snippet to feed the model.
   *
   * The snippet covers the format's rules, the active catalogs and any examples. The agent
   * developer writes the rest of the system prompt and places the snippet within it.
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
