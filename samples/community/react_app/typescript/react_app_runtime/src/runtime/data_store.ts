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

/** The data model requests of the bridge, as the store needs them. */
export interface DataTransport {
  get(path: string): Promise<{value?: unknown}>;
  set(path: string, value: unknown, seq: number): Promise<{seq: number; value?: unknown}>;
  subscribe(path: string): Promise<{value?: unknown}>;
}

/**
 * Called when a write fails: when the value isn't JSON, or after the store has re-read the path
 * from the host.
 */
export type WriteErrorHandler = (path: string, error: unknown) => void;

type Listener = () => void;

interface InFlight {
  count: number;
  lastFailed: boolean;
}

function describeKind(value: unknown): string {
  if (typeof value === 'function') {
    return 'a function';
  }
  if (typeof value !== 'object' || value === null) {
    return typeof value === 'number' ? String(value) : `a ${typeof value}`;
  }
  const name = (Object.getPrototypeOf(value) as {constructor?: {name?: string}} | null)?.constructor
    ?.name;
  return name ? `a ${name}` : 'an object that is not plain';
}

/**
 * Describes the first part of `value` that JSON can't carry, such as a `Date`, a `Map`, a
 * function, `NaN` or a circular reference, with its JSON pointer relative to `value`. Returns
 * `undefined` when `value` is JSON. `undefined` itself is allowed: it means "no value", and
 * object fields holding it are dropped.
 */
export function findNonJson(value: unknown): string | undefined {
  const ancestors = new Set<object>();
  const visit = (item: unknown, pointer: string): string | undefined => {
    if (item === undefined || item === null) {
      return undefined;
    }
    if (typeof item === 'string' || typeof item === 'boolean') {
      return undefined;
    }
    if (typeof item === 'number') {
      return Number.isFinite(item) ? undefined : `${pointer || 'the value'} is ${item}`;
    }
    if (typeof item !== 'object') {
      return `${pointer || 'the value'} is ${describeKind(item)}`;
    }
    if (ancestors.has(item)) {
      return `${pointer || 'the value'} is a circular reference`;
    }
    const prototype: unknown = Object.getPrototypeOf(item);
    const isArray = Array.isArray(item);
    if (!isArray && prototype !== Object.prototype && prototype !== null) {
      return `${pointer || 'the value'} is ${describeKind(item)}`;
    }
    ancestors.add(item);
    const entries = isArray
      ? (item as unknown[]).map((child, index) => [String(index), child] as const)
      : Object.entries(item);
    for (const [key, child] of entries) {
      const found = visit(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      if (found) {
        return found;
      }
    }
    ancestors.delete(item);
    return undefined;
  };
  return visit(value, '');
}

/** Structural equality with JSON semantics: key order is irrelevant, `undefined` fields are absent. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA).filter(key => recordA[key] !== undefined);
  const keysB = Object.keys(recordB).filter(key => recordB[key] !== undefined);
  return (
    keysA.length === keysB.length &&
    keysA.every(key => Object.hasOwn(recordB, key) && jsonEqual(recordA[key], recordB[key]))
  );
}

/**
 * The app's copy of the data model paths it uses, kept in sync with the host as
 * `docs/bridge_protocol.md` section 5 describes.
 *
 * Writes are optimistic: the store changes at once and the write goes to the host. While a path
 * has writes in flight, host changes to it are ignored; when the last write is acknowledged the
 * path takes the value the host reports, which is the data model's state after that write. If
 * the last write fails, the store re-reads the path from the host.
 *
 * Host subscriptions are made on first use and kept for the session: an app uses a handful of
 * paths, and React mounts and unmounts components often enough that dropping them would churn.
 */
export class AppDataStore {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly hostSubscribed = new Set<string>();
  /** Writes per path so far: a read answered after a newer write must not undo it. */
  private readonly writeCounts = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly transport: DataTransport,
    private readonly onWriteError?: WriteErrorHandler,
  ) {}

  /**
   * Seeds the store with the `initialize` snapshot. The host subscribes to every requested
   * path that the allowlist permits, so those count as subscribed even when they hold no value.
   */
  seed(snapshot: Readonly<Record<string, unknown>>, subscribedPaths: readonly string[]): void {
    for (const path of subscribedPaths) {
      this.hostSubscribed.add(path);
    }
    for (const [path, value] of Object.entries(snapshot)) {
      this.setLocal(path, true, value);
    }
  }

  /** Whether the store holds a value for `path`. */
  has(path: string): boolean {
    return this.values.has(path);
  }

  /** The value at `path`, or `undefined`. The same reference is returned until it changes. */
  get(path: string): unknown {
    return this.values.get(path);
  }

  /**
   * Calls `listener` whenever `path` changes, and subscribes to the path on the host the first
   * time it is watched. Returns a function that removes the listener.
   */
  watch(path: string, listener: Listener): () => void {
    let set = this.listeners.get(path);
    if (!set) {
      set = new Set();
      this.listeners.set(path, set);
    }
    set.add(listener);
    this.ensureHostSubscription(path);
    return () => {
      set.delete(listener);
    };
  }

  /** Reads `path` from the host, updating the store unless the path has writes in flight. */
  async read(path: string): Promise<unknown> {
    const writesBefore = this.writeCount(path);
    const result = await this.transport.get(path);
    if (this.isCurrent(path, writesBefore)) {
      this.setLocal(path, Object.hasOwn(result, 'value'), result.value);
    }
    return result.value;
  }

  /**
   * Writes `path`: updates the store at once and resolves once the host applied the write. A value
   * that isn't JSON is rejected at once and leaves the store unchanged.
   */
  async write(path: string, value: unknown): Promise<void> {
    const nonJson = findNonJson(value);
    if (nonJson) {
      const error = new TypeError(
        `Can't write ${path}: values must be JSON (plain objects, arrays, strings, finite` +
          ` numbers, booleans and null), but ${nonJson}.`,
      );
      this.onWriteError?.(path, error);
      throw error;
    }
    let entry = this.inFlight.get(path);
    if (!entry) {
      entry = {count: 0, lastFailed: false};
      this.inFlight.set(path, entry);
    }
    entry.count++;
    this.writeCounts.set(path, this.writeCount(path) + 1);
    this.setLocal(path, true, value);
    const seq = ++this.seq;
    try {
      const result = await this.transport.set(path, value, seq);
      this.settleWrite(path, entry, false, result);
    } catch (error) {
      this.settleWrite(path, entry, true, undefined);
      this.onWriteError?.(path, error);
      throw error;
    }
  }

  /** Applies a `data/changed` notification. */
  applyRemote(path: string, present: boolean, value: unknown): void {
    if (this.inFlight.has(path)) {
      return;
    }
    this.setLocal(path, present, value);
  }

  private settleWrite(
    path: string,
    entry: InFlight,
    failed: boolean,
    result: {value?: unknown} | undefined,
  ): void {
    entry.count--;
    entry.lastFailed = failed;
    if (entry.count > 0) {
      return;
    }
    this.inFlight.delete(path);
    if (!failed && result) {
      this.setLocal(path, Object.hasOwn(result, 'value'), result.value);
      return;
    }
    // The model may hold an earlier write or the host's own value: ask for it.
    this.read(path).catch(() => {
      // The write error is already reported; a failed re-read leaves the optimistic value.
    });
  }

  private ensureHostSubscription(path: string): void {
    if (this.hostSubscribed.has(path)) {
      return;
    }
    this.hostSubscribed.add(path);
    const writesBefore = this.writeCount(path);
    this.transport.subscribe(path).then(
      result => {
        if (this.isCurrent(path, writesBefore)) {
          this.setLocal(path, Object.hasOwn(result, 'value'), result.value);
        }
      },
      () => {
        // Refused (allowlist) or failed: let a later watch try again; the error is reported by
        // the transport.
        this.hostSubscribed.delete(path);
      },
    );
  }

  private writeCount(path: string): number {
    return this.writeCounts.get(path) ?? 0;
  }

  /** Whether a host answer requested when `path` had `writesBefore` writes is still current. */
  private isCurrent(path: string, writesBefore: number): boolean {
    return !this.inFlight.has(path) && this.writeCount(path) === writesBefore;
  }

  private setLocal(path: string, present: boolean, value: unknown): void {
    if (!present) {
      if (!this.values.has(path)) {
        return;
      }
      this.values.delete(path);
    } else {
      if (this.values.has(path) && jsonEqual(this.values.get(path), value)) {
        return;
      }
      this.values.set(path, value);
    }
    for (const listener of [...(this.listeners.get(path) ?? [])]) {
      listener();
    }
  }
}
