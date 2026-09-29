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

/**
 * Per-conversation state keyed by a string, dropping the least recently used entry once
 * `maxEntries` is exceeded so a long-running server does not grow without bound.
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly maxEntries = 1000) {}

  getOrCreate(key: string, factory: () => V): V {
    const existing = this.map.get(key);
    if (existing) {
      this.map.delete(key);
      this.map.set(key, existing);
      return existing;
    }
    const created = factory();
    this.map.set(key, created);
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    return created;
  }
}
