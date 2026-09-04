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
 * A resolved dynamic value in a node's props: a snapshot of the current
 * value, pinned at emission. A new binding arrives through the node's props
 * whenever the underlying value changes.
 *
 * Literal and function-call values resolve to a read-only `ResolvedBinding`,
 * so a write without narrowing to {@link WritableBinding} is a type error
 * rather than a silent no-op.
 *
 * Named `ResolvedBinding` because `DataBinding` is the exported wire model
 * of the `{"path": ...}` payload this resolves from; the two names stay
 * visibly distinct.
 */
export class ResolvedBinding<T> {
  constructor(readonly value: T) {}
}

/** A binding whose payload bound a data path, so writes have a destination. */
export class WritableBinding<T> extends ResolvedBinding<T> {
  constructor(
    value: T,
    readonly set: (value: T) => void,
    /** The authored data path, not resolved against the node's data scope. */
    readonly path: string,
  ) {
    super(value);
  }
}

/** Narrows a binding to {@link WritableBinding}. */
export function isWritable<T>(binding: ResolvedBinding<T>): binding is WritableBinding<T> {
  return binding instanceof WritableBinding;
}

/**
 * Whether two bindings count as unchanged for props change detection: same
 * writability, same write destination, and equal snapshot values. Plain
 * arrays and objects compare structurally; non-plain objects compare by
 * identity only, mirroring the resolver's change detection for props.
 */
export function sameBinding(a: ResolvedBinding<unknown>, b: ResolvedBinding<unknown>): boolean {
  if (isWritable(a) !== isWritable(b)) {
    return false;
  }
  if (isWritable(a) && isWritable(b) && a.path !== b.path) {
    return false;
  }
  return valueEquals(a.value, b.value);
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
