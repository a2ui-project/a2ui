/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** The default limit on the JSON of the data models sent in one model context update. */
export const DEFAULT_MODEL_CONTEXT_MAX_BYTES = 16 * 1024;

/**
 * How long the app waits after the user's last change, or the last action result that changed a
 * data model, before it updates the model context.
 */
export const MODEL_CONTEXT_DEBOUNCE_MS = 300;

/** The data model of a surface created with `sendDataModel: true`. */
export interface SharedDataModel {
  surfaceId: string;
  dataModel: unknown;
}

/**
 * Formats the data models of surfaces for the model context, as one text.
 *
 * When their JSON exceeds `maxBytes` in total, the largest data models are left out, largest
 * first, until the rest fits; each one left out is named with its size instead. Data models are
 * never truncated, so the model never reads partial JSON.
 */
export function formatModelContext(surfaces: readonly SharedDataModel[], maxBytes: number): string {
  const encoder = new TextEncoder();
  const entries = surfaces.map(({surfaceId, dataModel}) => {
    const json = JSON.stringify(dataModel ?? {});
    return {surfaceId, json, bytes: encoder.encode(json).length, included: true};
  });
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const entry of [...entries].sort((a, b) => b.bytes - a.bytes)) {
    if (total <= maxBytes) break;
    entry.included = false;
    total -= entry.bytes;
  }
  return entries
    .map(({surfaceId, json, bytes, included}) =>
      included
        ? `A2UI surface ${JSON.stringify(surfaceId)} data model:\n${json}`
        : `A2UI surface ${JSON.stringify(surfaceId)} data model was left out: its JSON is ` +
          `${bytes} bytes, above the ${maxBytes} byte limit.`,
    )
    .join('\n\n');
}

/**
 * Keeps the host's model context in sync with the data models the user changes.
 *
 * The user changes a data model directly, through the components, or by triggering an action
 * whose result changes it. `schedule` sends the data models once these changes stop for
 * {@link MODEL_CONTEXT_DEBOUNCE_MS}. `refresh` and `clear` only replace a context sent before,
 * so the app never shares a data model the user did not change.
 */
export class ModelContextSync {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shared = false;

  /**
   * @param send Replaces the host's model context with `text`, or clears it when `text` is
   *     undefined.
   * @param maxBytes The limit passed to {@link formatModelContext}.
   */
  constructor(
    private readonly send: (text: string | undefined) => void,
    private readonly maxBytes: number,
  ) {}

  /** Sends the data models `read` returns once the user stops changing them. */
  schedule(read: () => SharedDataModel[]): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.replace(read());
    }, MODEL_CONTEXT_DEBOUNCE_MS);
  }

  /** Replaces a context sent before with the data models `read` returns now. */
  refresh(read: () => SharedDataModel[]): void {
    if (this.shared && this.timer === undefined) this.replace(read());
  }

  /** Cancels a pending update and clears a context sent before. */
  clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.shared) this.replace([]);
  }

  private replace(surfaces: SharedDataModel[]): void {
    this.shared = surfaces.length > 0;
    this.send(this.shared ? formatModelContext(surfaces, this.maxBytes) : undefined);
  }
}
