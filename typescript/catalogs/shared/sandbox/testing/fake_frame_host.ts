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

import type {FrameHost, FrameHostSubscription} from '../frame_host.js';

/** A recorded `dispatchAction` call. */
export interface RecordedAction {
  readonly name: string;
  readonly context: Readonly<Record<string, unknown>>;
}

/** A recorded `invokeFunction` call. */
export interface RecordedFunctionCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function parsePath(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map(segment => segment.replace(/~([01])/g, (_, c) => (c === '1' ? '/' : '~')));
}

/**
 * In-memory {@link FrameHost} for tests. The data model is a JSON tree addressed by JSON
 * pointers; like the surface data model, it notifies subscribers synchronously during a write,
 * for the written path and every path above or below it, and rejects writes through prototype
 * pollution segments. Functions are registered by name; actions are recorded.
 */
export class FakeFrameHost implements FrameHost {
  readonly actions: RecordedAction[] = [];
  readonly functionCalls: RecordedFunctionCall[] = [];
  readonly functions = new Map<string, (args: Readonly<Record<string, unknown>>) => unknown>();

  private root: Record<string, unknown>;
  private readonly subscribers = new Map<string, Set<(value: unknown) => void>>();

  constructor(initialData: Record<string, unknown> = {}) {
    this.root = structuredClone(initialData);
  }

  /** Number of live subscriptions, for cleanup assertions. */
  get subscriberCount(): number {
    let count = 0;
    for (const callbacks of this.subscribers.values()) {
      count += callbacks.size;
    }
    return count;
  }

  getData(path: string): unknown {
    let current: unknown = this.root;
    for (const segment of parsePath(path)) {
      if (typeof current !== 'object' || current === null || FORBIDDEN_SEGMENTS.has(segment)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  setData(path: string, value: unknown): void {
    const segments = parsePath(path);
    if (segments.length === 0) {
      throw new Error('Cannot replace the data model root');
    }
    for (const segment of segments) {
      if (FORBIDDEN_SEGMENTS.has(segment)) {
        throw new Error(`Invalid path segment "${segment}" in ${path}`);
      }
    }
    let current: Record<string, unknown> = this.root;
    for (const segment of segments.slice(0, -1)) {
      const next = current[segment];
      if (typeof next !== 'object' || next === null) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = value;

    for (const [subscribedPath, callbacks] of this.subscribers) {
      if (isRelated(path, subscribedPath)) {
        const next = this.getData(subscribedPath);
        for (const callback of callbacks) {
          callback(next);
        }
      }
    }
  }

  subscribeData(path: string, onChange: (value: unknown) => void): FrameHostSubscription {
    let callbacks = this.subscribers.get(path);
    if (!callbacks) {
      callbacks = new Set();
      this.subscribers.set(path, callbacks);
    }
    callbacks.add(onChange);
    return {
      unsubscribe: () => {
        callbacks.delete(onChange);
      },
    };
  }

  invokeFunction(name: string, args: Readonly<Record<string, unknown>>): unknown {
    this.functionCalls.push({name, args});
    const fn = this.functions.get(name);
    if (!fn) {
      throw new Error(`Unknown function: ${name}`);
    }
    return fn(args);
  }

  dispatchAction(name: string, context: Readonly<Record<string, unknown>>): void {
    this.actions.push({name, context});
  }
}

/** Whether one pointer is the other or one of its ancestors. */
function isRelated(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
