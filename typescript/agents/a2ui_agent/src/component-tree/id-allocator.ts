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

/**
 * Allocates deterministic component IDs inside one scope.
 *
 * An allocated ID is `<prefix>__<component>_<n>`, with the component name lowercased and
 * `n` counted per component name, skipping IDs that are already taken. An ID the author
 * set is namespaced as `<prefix>__<id>`.
 */
export class IdAllocator {
  private readonly counters = new Map<string, number>();
  private readonly taken: Set<string>;

  constructor(
    private readonly prefix: string,
    reserved: Iterable<string> = [],
  ) {
    this.taken = new Set(reserved);
  }

  allocate(componentName: string, preferredId?: string): string {
    if (preferredId) {
      const namespaced = `${this.prefix}__${preferredId}`;
      this.taken.add(namespaced);
      return namespaced;
    }
    const name = componentName.toLowerCase();
    for (;;) {
      const next = (this.counters.get(name) ?? 0) + 1;
      this.counters.set(name, next);
      const candidate = `${this.prefix}__${name}_${next}`;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }
}
