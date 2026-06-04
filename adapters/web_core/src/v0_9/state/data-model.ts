/*
 * Copyright 2025 Google LLC
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

import {Subscription as BaseSubscription} from '../common/events.js';
import {A2uiDataError} from '../errors.js';
import {signal, Signal, batch, effect} from '@preact/signals-core';

/**
 * Represents a reactive connection to a specific path in the data model.
 */
export interface DataSubscription<T> extends BaseSubscription {
  /**
   * The current value at the subscribed path.
   */
  readonly value: T | undefined;
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * A standalone, observable data store representing the client-side state.
 * It handles JSON Pointer path resolution and subscription management.
 */
export class DataModel {
  private data: Record<string, unknown> = {};
  private readonly signals: Map<string, Signal<any>> = new Map();
  private readonly subscriptions: Set<() => void> = new Set(); // To track direct subscriptions for dispose

  /**
   * Creates a new data model.
   *
   * @param initialData The initial data for the model. Defaults to an empty object.
   */
  constructor(initialData: Record<string, unknown> = {}) {
    this.data = initialData;
  }

  /**
   * Retrieves a Preact Signal for a specific data path.
   *
   * This provides a reactive way to access a value. If the value at the path changes via `set()`,
   * the signal will automatically be updated.
   *
   * @param path The JSON pointer path to create or retrieve a signal for.
   * @returns A Preact Signal representing the value at the specified path.
   */
  getSignal<T>(path: string): Signal<T | undefined> {
    const normalizedPath = this.normalizePath(path);
    if (!this.signals.has(normalizedPath)) {
      this.signals.set(normalizedPath, signal(this.get(normalizedPath)));
    }
    return this.signals.get(normalizedPath) as Signal<T | undefined>;
  }

  /**
   * Updates the model at the specific path and notifies all relevant signals.
   * If path is '/' or empty, replaces the entire root.
   *
   * Note on `undefined` values:
   * - For objects: Setting a property to `undefined` removes the key from the object.
   * - For arrays: Setting an index to `undefined` sets that index to `undefined` but preserves the array length (sparse array).
   */
  set(path: string, value: any): this {
    if (path === null || path === undefined) {
      throw new A2uiDataError('Path cannot be null or undefined.');
    }

    if (path === '/' || path === '') {
      this.data = value;
      this.notifyAllSignals();
      return this;
    }

    const segments = this.parsePath(path);
    const lastSegment = segments.pop()!;

    if (!this.data) {
      this.data = {};
    }
    let current: any = this.data;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (Array.isArray(current) && !isNumeric(segment)) {
        throw new A2uiDataError(
          `Cannot use non-numeric segment '${segment}' on an array in path '${path}'.`,
          path,
        );
      }

      // If we encounter a primitive where a container is expected, we cannot proceed.
      // We allow undefined/null to be overwritten by a new container.
      if (
        current[segment] !== undefined &&
        current[segment] !== null &&
        typeof current[segment] !== 'object'
      ) {
        throw new A2uiDataError(
          `Cannot set path '${path}': segment '${segment}' is a primitive value.`,
          path,
        );
      }

      if (current[segment] === undefined || current[segment] === null) {
        const nextSegment = i < segments.length - 1 ? segments[i + 1] : lastSegment;
        current[segment] = isNumeric(nextSegment) ? [] : {};
      }
      current = current[segment];
    }

    if (Array.isArray(current) && !isNumeric(lastSegment)) {
      throw new A2uiDataError(
        `Cannot use non-numeric segment '${lastSegment}' on an array in path '${path}'.`,
        path,
      );
    }

    if (value === undefined) {
      if (Array.isArray(current)) {
        current[parseInt(lastSegment, 10)] = undefined;
      } else {
        delete current[lastSegment];
      }
    } else {
      current[lastSegment] = value;
    }

    this.notifySignals(path);
    return this;
  }

  /**
   * Retrieves data at a specific JSON pointer path.
   *
   * @param path The JSON pointer path to read from.
   * @returns The value at the specified path, or undefined if not found.
   */
  get(path: string): any {
    if (path === null || path === undefined) {
      throw new A2uiDataError('Path cannot be null or undefined.');
    }
    if (path === '/' || path === '') {
      return this.data;
    }

    const segments = this.parsePath(path);
    let current: any = this.data;
    for (const segment of segments) {
      if (current === undefined || current === null) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  /**
   * Subscribes to changes at the specified data path.
   *
   * This is a backwards-compatible layer using Preact Signals internally. It allows
   * listeners to be notified whenever the value at the specified path (or any of its
   * ancestors/descendants) changes.
   *
   * @param path The JSON pointer path to observe.
   * @param onChange A callback fired whenever the value changes.
   * @returns A `DataSubscription` containing the initial value and an `unsubscribe` method.
   */
  subscribe<T>(path: string, onChange: (value: T | undefined) => void): DataSubscription<T> {
    const sig = this.getSignal<T>(path);
    let isSync = true;
    let currentValue = sig.peek();

    const dispose = effect(() => {
      const val = sig.value;
      currentValue = val;
      if (!isSync) {
        onChange(val);
      }
    });
    isSync = false;

    this.subscriptions.add(dispose);

    return {
      get value() {
        return currentValue;
      },
      unsubscribe: () => {
        dispose();
        this.subscriptions.delete(dispose);
      },
    };
  }

  /**
   * Clears all internal subscriptions.
   */
  dispose(): void {
    for (const dispose of this.subscriptions) {
      dispose();
    }
    this.subscriptions.clear();
    this.signals.clear();
  }

  private normalizePath(path: string): string {
    if (path.length > 1 && path.endsWith('/')) {
      return path.slice(0, -1);
    }
    return path || '/';
  }

  private parsePath(path: string): string[] {
    return path.split('/').filter(p => p.length > 0);
  }

  private notifySignals(path: string): void {
    const normalizedPath = this.normalizePath(path);

    batch(() => {
      this.updateSignal(normalizedPath);

      // Notify Ancestors
      let parentPath = normalizedPath;
      while (parentPath !== '/' && parentPath !== '') {
        parentPath = parentPath.substring(0, parentPath.lastIndexOf('/')) || '/';
        this.updateSignal(parentPath);
      }

      // Notify Descendants
      for (const subPath of this.signals.keys()) {
        if (this.isDescendant(subPath, normalizedPath)) {
          this.updateSignal(subPath);
        }
      }
    });
  }

  private updateSignal(path: string): void {
    const sig = this.signals.get(path);
    if (sig) {
      const val = this.get(path);
      if (Array.isArray(val)) {
        sig.value = [...val];
      } else if (typeof val === 'object' && val !== null) {
        sig.value = {...val};
      } else {
        sig.value = val;
      }
    }
  }

  private notifyAllSignals(): void {
    batch(() => {
      for (const path of this.signals.keys()) {
        this.updateSignal(path);
      }
    });
  }

  private isDescendant(childPath: string, parentPath: string): boolean {
    if (parentPath === '/' || parentPath === '') {
      return childPath !== '/';
    }
    return childPath.startsWith(parentPath + '/');
  }
}
