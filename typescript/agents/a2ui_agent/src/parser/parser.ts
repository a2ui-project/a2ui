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

import {A2uiCompilationError, withPartialResults} from '../errors.js';
import {A2uiError, AgentToRendererMessage, CatalogApi} from '../internal/web-core.js';
import {RendererState} from '../utils/renderer-state.js';
import {RawResponsePart, ResponsePart, StreamPart} from './response-part.js';
import {ResponseStream} from './response-stream.js';

/** Options for reading a model response. */
export interface ParseOptions {
  /** False if the whole response is one block, without tags. Defaults to true. */
  wrapped?: boolean;
  /**
   * The state to check the messages against and apply them to. A new, empty state for this
   * call when omitted.
   */
  state?: RendererState;
}

/** Options for reading a streamed model response. */
export interface StreamOptions extends ParseOptions {
  /**
   * What the stream does once it rejects a block. With `'end'`, the default, the stream ends:
   * `feed` or `close` throws. With `'continue'`, the stream returns an `ErrorPart` in place of
   * the block and reads on: the messages the block emitted before it was rejected stay, the
   * rest of the block is skipped, and the text and blocks after it are read as usual.
   *
   * A block is rejected when it cannot be read or the state rejects one of its messages. Any
   * other error ends the stream either way.
   */
  afterRejectedBlock?: 'end' | 'continue';
}

/** Options for a stream that reads past rejected blocks, and so returns `ErrorPart`s. */
export type ContinuingStreamOptions = StreamOptions & {afterRejectedBlock: 'continue'};

/**
 * Abstract base class for A2UI payload parsers.
 *
 * A format implements `compile` and `decompile`, which translate between its notation and
 * A2UI messages, and the tag handling around them. The base class reads model responses:
 * `parseResponse` reads a whole one and `openStream` a streamed one, and both check every
 * message they compile against a `RendererState`, the one a call is given or a new one. A
 * chat agent passes none, so every turn shows new UI. A canvas agent passes the same state
 * every turn, so each turn is checked against the surfaces earlier turns built.
 *
 * A parser holds no state, so one parser can be reused across turns and responses.
 */
export abstract class Parser {
  /** The active catalogs in priority order. */
  abstract readonly catalogs: CatalogApi[];

  /**
   * Unwraps a raw model response string into a sequence of text and raw format blocks.
   */
  abstract unwrap(content: string): RawResponsePart[];

  /**
   * Compiles one raw format block into A2UI messages.
   *
   * Compiling translates the notation and reports what the notation itself gets wrong. It
   * does not check the messages against the catalogs or a renderer state: `parseResponse`
   * and `openStream` do, and `parseResponse(block, {wrapped: false})` compiles and checks
   * one block.
   *
   * @param formatContent The text of the block.
   * @param isFinal False if the block is still open, as at the end of a truncated response.
   */
  abstract compile(formatContent: string, isFinal?: boolean): AgentToRendererMessage[];

  /**
   * Decompiles structured A2UI messages back into this format's raw notation.
   */
  abstract decompile(a2uiPayload: AgentToRendererMessage[]): string;

  /**
   * Wraps multiple raw blocks with the format's enclosing tags/markers.
   */
  abstract wrap(blocks: RawResponsePart[]): string;

  /**
   * Reports whether the content carries a block written in this format.
   *
   * Reads the sentinel tags only and never compiles, so a caller can decide whether a
   * response is this format's business without paying for a parse.
   *
   * @param content Raw response text, possibly partial.
   * @param options.complete Whether to require a closed block. When false, the default, an
   *     opening tag on its own counts, which is what a streaming caller needs to know it has
   *     started receiving a payload.
   * @returns True when the content carries a block belonging to this format.
   */
  abstract hasFormatContent(content: string, options?: {complete?: boolean}): boolean;

  /**
   * Creates the empty state a call uses when it is given none.
   *
   * A call without a state checks a response that shows new UI, so an update to a surface
   * the response did not create is rejected.
   */
  protected emptyState(): RendererState {
    return new RendererState(this.catalogs);
  }

  /**
   * Parses a complete model response into structured parts.
   *
   * Nothing has been sent when a whole response is parsed, so it is checked as a whole: a
   * component may name a child that a later block adds, and the trees of the surfaces the
   * response touches are checked once every block is applied. The messages are applied to
   * the state all or nothing: if any check fails, the state is left as it was.
   *
   * A block cut off at the end of the response, which formats other than Direct JSON compile
   * as far as it goes, is applied too, but the trees of the surfaces it touches are not
   * checked.
   *
   * @param content The raw model response.
   * @param options Whether the response is wrapped in tags, and the state to check it
   *     against.
   * @throws {A2uiError} If a block cannot be read or the state rejects it. The error's
   *     `partialResults` holds the parts before the failing block, or only the text when a
   *     tree check fails, since that check spans every block. None of them is applied to the
   *     state.
   */
  parseResponse(content: string, {wrapped = true, state}: ParseOptions = {}): ResponsePart[] {
    const target = state ?? this.emptyState();
    const parts: ResponsePart[] = [];
    return target.transaction(() => {
      const touched = new Set<string>();
      const incomplete = new Set<string>();
      try {
        const rawParts: RawResponsePart[] = wrapped
          ? this.unwrap(content)
          : [{type: 'a2ui', a2uiRaw: content, isFinal: true}];
        for (const raw of rawParts) {
          if (raw.type === 'text') {
            parts.push({type: 'text', text: raw.text});
            continue;
          }
          const messages = this.compileBlock(raw.a2uiRaw, raw.isFinal);
          for (const surfaceId of target.apply(messages)) {
            touched.add(surfaceId);
            if (!raw.isFinal) incomplete.add(surfaceId);
          }
          parts.push({type: 'a2ui', a2ui: messages});
        }
      } catch (e) {
        throw withPartialResults(e, parts);
      }
      try {
        const complete = [...touched].filter(s => !incomplete.has(s));
        if (complete.length > 0) target.checkTopology(complete);
      } catch (e) {
        // The tree check spans every block, so no block is known to be good: only the text is
        // kept.
        throw withPartialResults(
          e,
          parts.filter(p => p.type === 'text'),
        );
      }
      // A truncated block's messages are kept, as the renderer the caller sends them to will
      // hold them, but its trees are not checked: a cut-off block is missing what it would
      // have added. Its components are marked checked, so a later turn is not required to
      // make them reachable; its dangling references and a missing root are still reported
      // when a later turn checks the surface.
      target.markChecked(incomplete);
      return parts;
    });
  }

  /**
   * Compiles a block, raising any failure that is not an `A2uiError` as
   * `A2uiCompilationError`.
   */
  private compileBlock(formatContent: string, isFinal: boolean): AgentToRendererMessage[] {
    try {
      return this.compile(formatContent, isFinal);
    } catch (e) {
      if (e instanceof A2uiError) throw e;
      const reason = e instanceof Error ? e.message : String(e);
      throw new A2uiCompilationError(`Failed to compile A2UI block: ${reason}`, {
        rawContent: formatContent,
      });
    }
  }

  /** Whether `openStream` can read a response from this format chunk by chunk. */
  get supportsStreaming(): boolean {
    return false;
  }

  /**
   * Opens a stream that reads one response chunk by chunk.
   *
   * @param options Whether the response is wrapped in tags, the state to check it against and
   *     apply it to, and whether to read past a rejected block.
   * @throws {Error} If the format cannot be read incrementally.
   */
  openStream(options: ContinuingStreamOptions): ResponseStream<StreamPart>;
  openStream(options?: StreamOptions): ResponseStream;
  openStream(_options: StreamOptions = {}): ResponseStream<StreamPart> {
    throw new Error(`Streaming is not supported by ${this.constructor.name}`);
  }
}
