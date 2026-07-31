/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * A resolved two-way value in a node's props: a snapshot of the current
 * value, plus a write capability present only when the payload bound a data
 * path. `set` is absent for literal and function-call values, so a write
 * without checking writability is a type error rather than a silent no-op.
 *
 * The snapshot is pinned at emission: a new binding arrives through the
 * node's props whenever the underlying value changes.
 *
 * Named `ResolvedBinding` because `DataBinding` is the wire model of the
 * `{"path": ...}` payload.
 */
export class ResolvedBinding<T> {
  constructor(
    readonly value: T,
    readonly set?: (value: T) => void,
  ) {}

  /** Whether writes have a destination (the payload bound a data path). */
  get writable(): boolean {
    return this.set !== undefined;
  }
}

/**
 * Whether two bindings count as unchanged for props change detection: same
 * writability and equal snapshot values. Plain arrays and objects compare
 * structurally; non-plain objects compare by identity only, mirroring the
 * resolver's change detection for props.
 */
export function sameBinding(a: ResolvedBinding<unknown>, b: ResolvedBinding<unknown>): boolean {
  return a.writable === b.writable && valueEquals(a.value, b.value);
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => valueEquals(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length && aKeys.every(key => key in b && valueEquals(a[key], b[key]))
    );
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
