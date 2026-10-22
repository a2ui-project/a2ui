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
import {ResponsePart} from './response-part.js';

/**
 * Reads one streamed model response, chunk by chunk.
 *
 * A stream holds the text buffers of one response and the `RendererState` its messages are
 * applied to. Each message it emits has been applied to the state, in the order emitted, and
 * no other message has, so the state mirrors what a renderer that received the emitted parts
 * holds.
 */
export interface ResponseStream {
  /** The state the stream's messages are applied to. */
  readonly state: RendererState;

  /**
   * Reads the next chunk and returns the parts that became ready.
   *
   * If it throws, the stream has ended: the response cannot be read further once part of it
   * is rejected.
   *
   * @throws {ParseError} If a block cannot be read.
   * @throws {A2uiValidationError} If a message is rejected.
   * @throws {Error} If the stream has ended.
   */
  feed(chunk: string): ResponsePart[];

  /**
   * Ends the response and returns the parts still held back.
   *
   * Call it after the last chunk: text that could still have started a tag is held until
   * then, and an unwrapped response is checked as a whole only then. Closing a stream that
   * has ended returns nothing.
   *
   * @throws {ParseError} If a block is still open.
   * @throws {A2uiValidationError} If the messages the response left behind are rejected.
   */
  close(): ResponsePart[];
}
