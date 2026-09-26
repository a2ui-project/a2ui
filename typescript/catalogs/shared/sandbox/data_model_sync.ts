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

import type {FrameHost, FrameHostSubscription} from './frame_host.js';

/** A change the host pushes to the frame: the whole bound value, or one field of it. */
export interface DataModelUpdate {
  /** Key of the binding in the component's `data.paths`. */
  readonly key: string;
  /** JSON pointer relative to the bound path; absent when `value` replaces the whole binding. */
  readonly subpath?: string;
  readonly value: unknown;
}

/** A change the frame asks the host to write; same shape as {@link DataModelUpdate}. */
export type DataModelChange = DataModelUpdate;

/**
 * What happened to a frame change: written to the data model, dropped because the model already
 * held an equal value, or dropped because the key is not bound in `data.paths`.
 */
export type DataModelChangeResult = 'applied' | 'unchanged' | 'unbound';

/** Inputs of {@link DataModelSync}. */
export interface DataModelSyncOptions {
  readonly host: Pick<FrameHost, 'getData' | 'setData' | 'subscribeData'>;
  /** The component's `data.paths`: binding key to absolute JSON pointer in the data model. */
  readonly paths: Readonly<Record<string, string>>;
  /** Delivers an update to the frame, in whichever framing the bridge protocol uses. */
  readonly sendUpdate: (update: DataModelUpdate) => void;
}

/** Escapes a JSON pointer reference token (RFC 6901). */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Joins a bound path and a frame-supplied subpath, tolerating a missing leading slash. */
export function resolveBoundPath(path: string, subpath: string | undefined): string {
  if (!subpath) {
    return path;
  }
  return `${path}${subpath.startsWith('/') ? '' : '/'}${subpath}`;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function definedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter(key => record[key] !== undefined);
}

/** Structural equality with JSON semantics: key order is irrelevant and `undefined` fields are absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (!isRecordLike(a) || !isRecordLike(b) || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  const keysA = definedKeys(a);
  const keysB = definedKeys(b);
  return keysA.length === keysB.length && keysA.every(key => key in b && deepEqual(a[key], b[key]));
}

/**
 * Two-way synchronisation of the paths a frame component binds through `data.paths`.
 *
 * Host to frame: every bound path is subscribed; when its value changes, objects are diffed
 * field by field against the last value the frame received and only the changed fields are sent
 * as subpath updates (which keeps concurrent writers from clobbering each other), while other
 * values are sent whole. Updates that would carry an equal value are dropped.
 *
 * Frame to host: {@link applyChange} writes the requested value unless the model already holds
 * an equal one. The write happens under a flag that the subscription callback checks, so the
 * frame does not receive an echo of its own change; this relies on the data model notifying
 * subscribers synchronously during the write, which the surface data model does.
 */
export class DataModelSync {
  private readonly subscriptions: FrameHostSubscription[] = [];
  private readonly lastSentValues = new Map<string, unknown>();
  private applyingFrameChange = false;

  constructor(private readonly options: DataModelSyncOptions) {}

  /**
   * Reads the current value of every bound path, subscribes to their changes and returns the
   * values keyed by binding key, for the frame's initial state. Calling it again resubscribes.
   */
  start(): Record<string, unknown> {
    this.unsubscribeAll();
    const {host, paths} = this.options;
    const initialData: Record<string, unknown> = {};
    for (const [key, path] of Object.entries(paths)) {
      const value = host.getData(path);
      initialData[key] = value;
      this.lastSentValues.set(key, snapshot(value));
      this.subscriptions.push(host.subscribeData(path, next => this.handleHostChange(key, next)));
    }
    return initialData;
  }

  /** Writes a change requested by the frame; see {@link DataModelChangeResult}. */
  applyChange(change: DataModelChange): DataModelChangeResult {
    const {host, paths} = this.options;
    const path = paths[change.key];
    if (!path) {
      return 'unbound';
    }
    const targetPath = resolveBoundPath(path, change.subpath);
    if (deepEqual(host.getData(targetPath), change.value)) {
      return 'unchanged';
    }
    this.applyingFrameChange = true;
    try {
      host.setData(targetPath, change.value);
    } finally {
      this.applyingFrameChange = false;
    }
    // The frame already holds this state, so later host changes are diffed against it.
    this.lastSentValues.set(change.key, snapshot(host.getData(path)));
    return 'applied';
  }

  /** Stops all subscriptions; the instance can be started again. */
  dispose(): void {
    this.unsubscribeAll();
    this.lastSentValues.clear();
  }

  private unsubscribeAll(): void {
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.unsubscribe();
    }
  }

  private handleHostChange(key: string, value: unknown): void {
    if (this.applyingFrameChange) {
      return;
    }
    const previous = this.lastSentValues.get(key);
    this.lastSentValues.set(key, snapshot(value));

    if (isRecordLike(value)) {
      const previousRecord = isRecordLike(previous) ? previous : undefined;
      for (const [field, fieldValue] of Object.entries(value)) {
        if (!deepEqual(previousRecord?.[field], fieldValue)) {
          this.options.sendUpdate({
            key,
            subpath: `/${escapePointerSegment(field)}`,
            value: fieldValue,
          });
        }
      }
      if (previousRecord) {
        for (const field of Object.keys(previousRecord)) {
          if (!Object.hasOwn(value, field)) {
            this.options.sendUpdate({
              key,
              subpath: `/${escapePointerSegment(field)}`,
              value: undefined,
            });
          }
        }
      }
    } else if (!deepEqual(previous, value)) {
      this.options.sendUpdate({key, value});
    }
  }
}

/** Detaches the cached copy from the live model value, in case the model mutates it in place. */
function snapshot(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}
