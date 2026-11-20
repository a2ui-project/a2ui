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

import type {RendererState} from '../utils/renderer-state.js';
import {ResponsePart, StreamPart} from './response-part.js';

/**
 * Reads one streamed model response, chunk by chunk.
 *
 * A stream holds the text buffers of one response and the `RendererState` its messages are
 * applied to. Each message it emits, whether `feed` and `close` return it or a thrown error
 * carries it in `partialResults`, has been applied to the state, in the order emitted, and no
 * other message has, so the state mirrors what a renderer that received the emitted parts
 * holds.
 *
 * What happens once a block is rejected depends on how the stream was opened. By default the
 * stream ends: `feed` or `close` throws. A stream opened with `afterRejectedBlock: 'continue'`
 * returns an `ErrorPart` in place of the block instead, drops what the block had not emitted
 * yet, and goes on with the text and blocks after it.
 *
 * @template Part The parts the stream returns: `StreamPart` for a stream that reads past
 *     rejected blocks, and `ResponsePart` for one that ends at them.
 */
export interface ResponseStream<Part extends StreamPart = ResponsePart> {
  /** The state the stream's messages are applied to. */
  readonly state: RendererState;

  /**
   * Whether the response read so far ends inside a block: after an opening tag, and before
   * its closing tag. An unwrapped response is one block, so its stream is inside it until it
   * ends. Text held back because it could start a tag is not inside a block. False once the
   * stream has ended.
   *
   * A caller that joins the chunks of a paused and resumed response reads it to tell whether
   * it may add text between them, such as a space, which inside a block could break the
   * block.
   */
  readonly isInBlock: boolean;

  /**
   * Reads the next chunk and returns the parts that became ready.
   *
   * If it throws, the stream has ended, and the error's `partialResults` holds the parts the
   * chunk made ready before the failure. They have been applied to the state like the parts
   * of any earlier chunk, so the caller shows them too.
   *
   * @throws {ParseError} If a block cannot be read and the stream ends at a rejected block.
   * @throws {A2uiValidationError} If a message is rejected and the stream ends at a rejected
   *     block.
   * @throws {Error} If the stream has ended.
   */
  feed(chunk: string): Part[];

  /**
   * Ends the response and returns the parts still held back.
   *
   * Call it after the last chunk: text that could still have started a tag is held until
   * then, and an unwrapped response is checked as a whole only then. Closing a stream that
   * has ended returns nothing. If it throws, the error's `partialResults` holds the parts
   * made ready before the failure, as for `feed`.
   *
   * @throws {ParseError} If a block is still open and the stream ends at a rejected block.
   *     A stream that reads past rejected blocks returns an `ErrorPart` for it instead.
   * @throws {A2uiValidationError} If the messages the response left behind are rejected and
   *     the stream ends at a rejected block.
   */
  close(): Part[];
}
