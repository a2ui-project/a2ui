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

import {InferenceFormat, InferenceFormatFactory} from '../inference-format.js';
import {ExpressFormatFactory} from '../inference-formats/express/format.js';
import {A2uiCatalogError, AgentToRendererMessage, CatalogApi} from '../internal/web-core.js';
import {ContinuingStreamOptions, ParseOptions, Parser, StreamOptions} from '../parser/parser.js';
import {ResponsePart, StreamPart} from '../parser/response-part.js';
import {ResponseStream} from '../parser/response-stream.js';
import {toReleaseLine, toWireProtocolVersion} from '../utils/protocol-version.js';
import {RendererState} from '../utils/renderer-state.js';

/** Options for a request processor. */
export interface A2uiRequestProcessorOptions {
  /**
   * The renderer state a canvas agent keeps for the conversation. `parseResponse` and
   * `openStream` use it when a call passes none. Without one, each call checks the response
   * against a new state, as a chat agent wants. A processor bound to a state serves only that
   * conversation.
   */
  state?: RendererState;
}

/** Request-scoped facade over the negotiated catalogs, prompt, parser, and validation. */
export class A2uiRequestProcessor {
  private readonly _format: InferenceFormat;
  private _parser?: Parser;
  private readonly _state?: RendererState;

  /**
   * @param catalogs The negotiated catalogs active for this request.
   * @param _examples Prompt examples, keyed by name.
   * @param formatFactory The inference format. Express by default.
   * @param options The renderer state to bind, if any.
   * @throws {A2uiCatalogError} If `options.state` holds other catalogs than `catalogs`.
   */
  constructor(
    private readonly catalogs: CatalogApi[],
    private readonly _examples?: Record<string, AgentToRendererMessage[] | string>,
    formatFactory?: InferenceFormatFactory,
    options: A2uiRequestProcessorOptions = {},
  ) {
    const factory = formatFactory || new ExpressFormatFactory();
    this._format = factory.createFormat(catalogs, _examples);
    this.checkState(options.state);
    this._state = options.state;
  }

  /** The negotiated catalogs active for this request. */
  get activeCatalogs(): CatalogApi[] {
    return this.catalogs;
  }

  get examples(): Record<string, AgentToRendererMessage[] | string> | undefined {
    return this._examples;
  }

  /** The renderer state bound to this processor, if any. */
  get state(): RendererState | undefined {
    return this._state;
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

  /**
   * The parser for the format, bound to the active catalogs.
   *
   * A parser holds no state, so the processor creates one and reuses it.
   */
  get parser(): Parser {
    this._parser ??= this._format.createParser();
    return this._parser;
  }

  /**
   * Creates an empty renderer state that holds the active catalogs.
   *
   * A canvas agent keeps the state for the whole conversation and passes it to
   * `parseResponse` or `openStream` on every turn, or binds it to the processor.
   */
  createState(): RendererState {
    return new RendererState(this.catalogs);
  }

  /**
   * Parses a model response and checks it against a renderer state.
   *
   * @param content The response text.
   * @param options Whether the response is wrapped in tags, and the renderer state to check
   *     the response against and apply it to. The state defaults to the one bound to the
   *     processor. With neither, the response is checked on its own, against a new state.
   * @throws {A2uiCatalogError} If the state holds other catalogs than the processor.
   * @throws {A2uiError} If a block cannot be read or a message is rejected.
   */
  parseResponse(content: string, options: ParseOptions = {}): ResponsePart[] {
    return this.parser.parseResponse(content, {...options, state: this.resolveState(options)});
  }

  /**
   * Opens a stream that reads one model response chunk by chunk.
   *
   * @param options Whether the response is wrapped in tags, the renderer state to check the
   *     response against and apply it to, as for `parseResponse`, and whether to read past a
   *     rejected block.
   * @throws {A2uiCatalogError} If the state holds other catalogs than the processor.
   * @throws {Error} If the format cannot be read incrementally.
   */
  openStream(options: ContinuingStreamOptions): ResponseStream<StreamPart>;
  openStream(options?: StreamOptions): ResponseStream;
  openStream(options: StreamOptions = {}): ResponseStream<StreamPart> {
    return this.parser.openStream({...options, state: this.resolveState(options)});
  }

  private resolveState(options: ParseOptions): RendererState | undefined {
    if (options.state === undefined) return this._state;
    this.checkState(options.state);
    return options.state;
  }

  /**
   * Whether the processor can check responses against a renderer state.
   *
   * A state is accepted when it holds the processor's active catalogs, in the same order, since
   * the order decides which catalog a surface resolves to. A state made with `createState` is
   * always accepted. An agent that keeps a state per conversation calls this to tell whether the
   * state still fits the request's catalogs, and makes a new one with `createState` when it
   * doesn't.
   */
  acceptsState(state: RendererState): boolean {
    return catalogsKey(state.catalogs) === catalogsKey(this.catalogs);
  }

  private checkState(state: RendererState | undefined): void {
    if (state === undefined || this.acceptsState(state)) return;
    throw new A2uiCatalogError(
      `The renderer state holds catalogs [${describeCatalogs(state.catalogs)}], but the processor's active catalogs are [${describeCatalogs(this.catalogs)}].`,
    );
  }
}

/**
 * The id and release line of each catalog, in order, to compare two lists of catalogs. A
 * v0.9 and a v0.9.1 catalog with the same id compare equal, since a `RendererState` treats
 * the two versions as one.
 */
function catalogsKey(catalogs: CatalogApi[]): string {
  return JSON.stringify(catalogs.map(c => [c.id, toReleaseLine(c.protocolVersion)]));
}

/** The id and normalized protocol version of each catalog, in order. */
function describeCatalogs(catalogs: CatalogApi[]): string {
  return catalogs.map(c => `${c.id} (${toWireProtocolVersion(c.protocolVersion)})`).join(', ');
}
