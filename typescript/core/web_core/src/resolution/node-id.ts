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

const COUNTER_KEY = Symbol.for('a2ui.nodeId');

/**
 * Returns the next node id, `a2ui-n<counter>`.
 *
 * The counter is shared through `globalThis`, so several bundled copies of
 * web_core on one page (one per renderer, for example) still produce ids that
 * are unique across the whole document.
 */
export function nextNodeId(): string {
  const global = globalThis as typeof globalThis & {[COUNTER_KEY]?: number};
  const next = (global[COUNTER_KEY] ?? 0) + 1;
  global[COUNTER_KEY] = next;
  return `a2ui-n${next}`;
}
