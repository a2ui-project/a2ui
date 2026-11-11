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

/** A live log of the bridge traffic of one turn's ReactApps, for the Bridge tab and the tests. */
import type {ReactAppBridgeEvent} from '@a2ui-labs/react-app';

/** One row of the Bridge tab. */
export interface BridgeEntry {
  readonly seq: number;
  /** `performance.now()` when the host saw it. */
  readonly time: number;
  /** `app→host`, `host→app`, or `lifecycle` for events the bridge reports itself. */
  readonly direction: 'app→host' | 'host→app' | 'lifecycle';
  /** JSON-RPC method, or `result` / `error` for responses, or the lifecycle event. */
  readonly method: string;
  readonly id?: number | string;
  /** For a response: the request's method and how long it took. */
  readonly request?: {readonly method: string; readonly durationMs: number};
  readonly payload: unknown;
  /** Serialized size in bytes. */
  readonly size: number;
}

/** Collects bridge events in order and notifies subscribers. */
export class BridgeLog {
  private entries: BridgeEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<string, {method: string; time: number}>();
  private seq = 0;

  /** The entries so far; a new array after every change. */
  getEntries = (): readonly BridgeEntry[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Records one event of a ReactApp element's `react-app-bridge` DOM event. */
  record(event: ReactAppBridgeEvent, time = performance.now()): BridgeEntry {
    let entry: BridgeEntry;
    if (event.type === 'message') {
      const message = event.message as {
        method?: string;
        id?: number | string;
        params?: unknown;
        result?: unknown;
        error?: unknown;
      };
      const direction = event.direction === 'in' ? 'app→host' : 'host→app';
      const key = `${direction}:${String(message.id)}`;
      let request: BridgeEntry['request'];
      if (message.method && message.id !== undefined) {
        this.pending.set(key, {method: message.method, time: event.time});
      } else if (message.id !== undefined) {
        const requestKey = `${direction === 'app→host' ? 'host→app' : 'app→host'}:${String(message.id)}`;
        const started = this.pending.get(requestKey);
        if (started) {
          this.pending.delete(requestKey);
          request = {method: started.method, durationMs: event.time - started.time};
        }
      }
      entry = {
        seq: ++this.seq,
        time: event.time,
        direction,
        method: message.method ?? (message.error ? 'error' : 'result'),
        ...(message.id !== undefined ? {id: message.id} : {}),
        ...(request ? {request} : {}),
        payload: message.params ?? message.result ?? message.error ?? null,
        size: JSON.stringify(event.message).length,
      };
    } else {
      const {type, ...rest} = event;
      entry = {
        seq: ++this.seq,
        time: 'time' in event ? event.time : time,
        direction: 'lifecycle',
        method: type,
        payload: rest,
        size: 0,
      };
    }
    this.entries = [...this.entries, entry];
    for (const listener of this.listeners) {
      listener();
    }
    return entry;
  }
}

/** Data model paths the app wrote, in the order it first wrote them. */
export function writtenPaths(entries: readonly BridgeEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.direction === 'app→host' && entry.method === 'data/set') {
      const path = (entry.payload as {path?: unknown} | null)?.path;
      if (typeof path === 'string') {
        paths.add(path);
      }
    }
  }
  return [...paths];
}
