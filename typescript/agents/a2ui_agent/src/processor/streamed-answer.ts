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

import {ComponentApi, MessageProcessor, SurfaceModel} from '../internal/web-core.js';
import {ErrorPart, StreamPart} from '../parser/response-part.js';
import {ResponseStream} from '../parser/response-stream.js';
import {RendererState} from '../utils/renderer-state.js';
import {A2uiRequestProcessor} from './processor.js';

/** Text the model wrote between two surfaces, or before or after them. */
export interface AnswerTextPart {
  type: 'text';
  text: string;
}

/** A surface the answer created, where the model wrote it. */
export interface AnswerSurfacePart<T extends ComponentApi = ComponentApi> {
  type: 'surface';
  surface: SurfaceModel<T>;
}

/** A part of an answer: its text, its surfaces, and the blocks it rejected. */
export type AnswerPart<T extends ComponentApi = ComponentApi> =
  | AnswerTextPart
  | AnswerSurfacePart<T>
  | ErrorPart;

/** Options for a streamed answer. */
export interface StreamedAnswerOptions<T extends ComponentApi = ComponentApi> {
  /**
   * The processor the app renders the answer's surfaces from. It holds the processor's
   * active catalogs, and the answer's messages are checked and applied to it through
   * `RendererState.of`, so it takes its messages from the answer only.
   */
  renderer: MessageProcessor<T>;
}

/**
 * One model answer, read as it streams, for an app that is both the agent and the renderer.
 *
 * The answer opens a stream on the request processor that applies each message to the
 * renderer's processor, and reads past a rejected block. It keeps the answer's parts in the
 * order the model wrote them: the text, one part per surface the answer creates, and an
 * `ErrorPart` where a block was rejected, followed by the text and surfaces after it. A
 * surface the answer deletes leaves the parts.
 *
 * Text the stream returns in pieces is joined into one part until a block comes between.
 */
export class StreamedAnswer<T extends ComponentApi = ComponentApi> {
  /** The processor the answer's surfaces are applied to. */
  readonly renderer: MessageProcessor<T>;
  private readonly stream: ResponseStream<StreamPart>;
  private _parts: readonly AnswerPart<T>[] = [];
  /** Whether the last part the stream returned was text, so more text joins it. */
  private inText = false;

  /**
   * @param processor The request processor whose prompt the model answered.
   * @param options The renderer's processor.
   * @throws {A2uiCatalogError} If the renderer's catalogs are not the processor's active
   *     catalogs, in the same order.
   * @throws {Error} If the processor's format cannot be read incrementally.
   */
  constructor(processor: A2uiRequestProcessor, {renderer}: StreamedAnswerOptions<T>) {
    this.renderer = renderer;
    this.stream = processor.openStream({
      state: RendererState.of(renderer),
      afterRejectedBlock: 'continue',
    });
  }

  /**
   * The parts of the answer so far, in the order the model wrote them. The list is replaced,
   * not changed, when the parts change.
   */
  get parts(): readonly AnswerPart<T>[] {
    return this._parts;
  }

  /** Whether the answer so far ends inside a block. See `ResponseStream.isInBlock`. */
  get isInBlock(): boolean {
    return this.stream.isInBlock;
  }

  /**
   * Reads the next chunk of the answer.
   *
   * @throws {Error} If the answer has been closed, or the stream fails for a reason other
   *     than a rejected block.
   */
  feed(chunk: string): void {
    this.show(this.stream.feed(chunk));
  }

  /** Ends the answer, adding the text held back as a possible tag and any rejected block. */
  close(): void {
    this.show(this.stream.close());
  }

  private show(streamParts: StreamPart[]): void {
    if (streamParts.length === 0) return;
    const parts = [...this._parts];
    for (const part of streamParts) {
      if (part.type === 'text') {
        const last = parts[parts.length - 1];
        if (this.inText && last?.type === 'text') {
          parts[parts.length - 1] = {type: 'text', text: last.text + part.text};
        } else {
          parts.push({type: 'text', text: part.text});
        }
        this.inText = true;
        continue;
      }
      this.inText = false;
      if (part.type === 'error') {
        parts.push(part);
        continue;
      }
      for (const message of part.a2ui as Record<string, unknown>[]) {
        const created = surfaceIdOf(message, 'createSurface');
        const surface = created === undefined ? undefined : this.renderer.model.getSurface(created);
        if (surface) parts.push({type: 'surface', surface});
        const deleted = surfaceIdOf(message, 'deleteSurface');
        if (deleted !== undefined) {
          const index = parts.findIndex(p => p.type === 'surface' && p.surface.id === deleted);
          if (index >= 0) parts.splice(index, 1);
        }
      }
    }
    this._parts = parts;
  }
}

/** The surface that a message's action names, if the message holds that action. */
function surfaceIdOf(message: Record<string, unknown>, action: string): string | undefined {
  const body = message[action];
  if (!body || typeof body !== 'object') return undefined;
  const surfaceId = (body as Record<string, unknown>).surfaceId;
  return typeof surfaceId === 'string' ? surfaceId : undefined;
}
