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

import {StreamPart} from './response-part.js';

/**
 * Emits the text of a streamed response that lies between its blocks.
 *
 * The text between two blocks is one run. A run is emitted as it arrives, less the
 * whitespace at its edges: leading whitespace is dropped at the start of a run, and trailing
 * whitespace is held until more text of the run follows, so a run ends where its last
 * non-blank character does, as the text parts of a whole response do.
 */
export class TextRun {
  private started = false;
  private heldSpace = '';

  /**
   * Emits `text` as the next piece of the run.
   *
   * Nothing is emitted for a piece that is blank; its whitespace is held for the next piece.
   */
  emit(parts: StreamPart[], text: string): void {
    const body = (this.started ? text : text.trimStart()).trimEnd();
    if (!body) {
      if (this.started) this.heldSpace += text;
      return;
    }
    const start = this.started ? 0 : text.indexOf(body);
    parts.push({type: 'text', text: `${this.heldSpace}${body}`});
    this.heldSpace = text.slice(start + body.length);
    this.started = true;
  }

  /** Ends the run, as a block does; whitespace held at its end is dropped. */
  reset(): void {
    this.started = false;
    this.heldSpace = '';
  }
}
