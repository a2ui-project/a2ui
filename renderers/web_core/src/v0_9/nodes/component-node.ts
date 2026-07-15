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

import {EventEmitter, EventSource} from '../common/events.js';
import {Signal, signal, peekValue, setValue} from '../reactivity/signals.js';

/** The `type` of a node whose component definition has not arrived yet. */
export const PLACEHOLDER_TYPE = 'Placeholder';

/** Resolved node properties, keyed by the component's schema property names. */
export type NodeProps = Record<string, unknown>;

/**
 * One resolved component instance in the rendered tree.
 *
 * A node's `props` hold fully resolved values: primitives for dynamic values,
 * ready-to-call `() => void` closures for actions, and live `ComponentNode`
 * references (or arrays of them) for child properties.
 *
 * Emission contract: `props` emits when this node's own resolved properties
 * change, including when a child *reference* is replaced (a placeholder
 * upgrade, a deletion, a list change). It does not emit when a child's
 * internal properties change; subscribe to the child's `props` for that.
 */
export class ComponentNode<TProps extends NodeProps = NodeProps> {
  /**
   * Identifier for this node in the rendered tree. The bare component id at
   * the root data scope; for template-spawned items the scoped data path is
   * appended (e.g. `item-card-[/items/0]`) so sibling keys are distinct.
   *
   * Until the spec provides data-derived child keys (a2ui#1745), this id
   * names a list position, not a data item: it is not stable across array
   * insertions or reorders.
   */
  readonly instanceId: string;
  /** The component id from the payload. */
  readonly componentId: string;
  /** The catalog component type, or `'Placeholder'`. */
  readonly type: string;
  /** The data model scope this node resolves against, e.g. `/items/0`. */
  readonly dataPath: string;
  /** Resolved, reactive properties. Read with `getValue`/`peekValue`. */
  readonly props: Signal<TProps>;

  private readonly _onDestroyed = new EventEmitter<void>();
  /** Fires exactly once, when this node is disposed. */
  readonly onDestroyed: EventSource<void> = this._onDestroyed;

  private cleanups: Array<() => void> = [];
  private _disposed = false;

  constructor(
    instanceId: string,
    componentId: string,
    type: string,
    dataPath: string,
    initialProps: TProps,
  ) {
    this.instanceId = instanceId;
    this.componentId = componentId;
    this.type = type;
    this.dataPath = dataPath;
    this.props = signal(initialProps);
  }

  get disposed(): boolean {
    return this._disposed;
  }

  get isPlaceholder(): boolean {
    return this.type === PLACEHOLDER_TYPE;
  }

  /** Registers teardown work to run when this node is disposed. */
  addCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  /**
   * Replaces the resolved props, emitting only if a shallow comparison shows
   * a change. Callers keep unchanged values reference-identical (child nodes
   * come from the resolver's cache; untouched arrays keep their identity), so
   * shallow comparison is exact rather than heuristic.
   */
  setProps(next: TProps): void {
    if (this._disposed) {
      return;
    }
    const previous = peekValue(this.props);
    if (!shallowEqual(previous, next)) {
      setValue(this.props, next);
    }
  }

  /**
   * Tears down this node: runs registered cleanups, then fires `onDestroyed`.
   * Idempotent.
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch (e) {
        console.error(`ComponentNode cleanup error (${this.instanceId}):`, e);
      }
    }
    this.cleanups = [];
    this._onDestroyed.emit();
    this._onDestroyed.dispose();
  }

  /**
   * Serializes the resolved tree for debugging and headless assertions.
   * Child nodes serialize recursively; action closures serialize as the
   * string `'<Action>'`.
   */
  toJSON(): Record<string, unknown> {
    if (this.isPlaceholder) {
      return {id: this.componentId, type: PLACEHOLDER_TYPE};
    }
    const serialized: Record<string, unknown> = {
      id: this.componentId,
      type: this.type,
    };
    const props = peekValue(this.props);
    for (const [key, value] of Object.entries(props)) {
      serialized[key] = serializeValue(value);
    }
    return serialized;
  }
}

function serializeValue(value: unknown): unknown {
  if (value instanceof ComponentNode) {
    return value.toJSON();
  }
  if (typeof value === 'function') {
    return '<Action>';
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key] = serializeValue(inner);
    }
    return result;
  }
  return value;
}

function shallowEqual(a: NodeProps, b: NodeProps): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
}
