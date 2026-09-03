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

import {EventEmitter, EventSource} from '../../common/events.js';
import type {ComponentApi} from '../../catalog/types.js';
import {Signal, signal, peekValue, setValue} from '../../reactivity/signals.js';
import {ResolvedBinding} from './resolved-binding.js';

/** The component type name used for pending and cyclic placeholder nodes. */
export const PLACEHOLDER_TYPE = 'Placeholder';

/**
 * Resolution state of a component node in the rendered tree.
 *
 * - `resolved`: Real component with a catalog entry; `impl` is set.
 * - `pending`: Component definition has not arrived; upgraded in place when received.
 * - `unknown-type`: Definition arrived but its type has no catalog entry.
 * - `cyclic`: Reference repeats one of the node's own ancestors.
 */
export type NodeState = 'resolved' | 'pending' | 'unknown-type' | 'cyclic';

/** Resolved component node properties, keyed by property name. */
export type NodeProps = Record<string, unknown>;

/**
 * Represents a single resolved component instance in the rendered tree.
 *
 * Node properties hold fully resolved values: `ResolvedBinding` instances for
 * dynamic values, ready-to-call `() => void` closures for actions, and live
 * `ComponentNode` references (or arrays of them) for child properties.
 *
 * Emits when this node's own resolved properties change, including when a child
 * reference is replaced. Does not emit when a child's internal properties change.
 */
export interface ComponentNode<
  C extends ComponentApi = ComponentApi,
  TProps extends NodeProps = NodeProps,
> {
  /**
   * Identifier for this node in the rendered tree, distinct among siblings.
   * The bare component id at the root data scope; for template-spawned items
   * the scoped data path is appended (e.g. `item-card-[/items/0]`); when one
   * parent references the same component at the same scope more than once,
   * each further occurrence gains a `#n` suffix (e.g. `item-card#2`). The
   * characters that carry meaning in this composition (`~`, `#`, `[`, `]`)
   * are escaped in the component id and data path, so ids that mimic a
   * suffixed or scoped form cannot collide with one.
   *
   * Until the spec provides data-derived child keys (a2ui#1745), this id
   * names a list position, not a data item: it is not stable across array
   * insertions or reorders.
   */
  readonly instanceId: string;
  /** The component id from the payload. */
  readonly componentId: string;
  /**
   * The catalog component type. `'Placeholder'` for pending and cyclic
   * stand-ins; an unknown-type node keeps its declared type.
   */
  readonly type: string;
  /** The data model scope this node resolves against, e.g. `/items/0`. */
  readonly dataPath: string;
  /** The resolved catalog entry for `type`; undefined while a placeholder. */
  readonly impl: C | undefined;
  /** Why this node is or is not resolved. */
  readonly state: NodeState;
  /** Resolved, reactive properties. Read with `getValue`/`peekValue`. */
  readonly props: Signal<TProps>;
  /** Fires exactly once, when this node is disposed. */
  readonly onDestroyed: EventSource<void>;
  /** Whether this node has been disposed. */
  readonly disposed: boolean;
  /**
   * Whether this node is an unresolved stand-in (`state` other than `resolved`).
   *
   * A placeholder holds the child position with empty properties until the
   * component becomes resolvable and is replaced in place.
   */
  readonly isPlaceholder: boolean;
  /**
   * Registers teardown work to run when this node is disposed.
   *
   * @param cleanup Teardown callback.
   */
  addCleanup(cleanup: () => void): void;
  /**
   * Serializes the resolved tree for debugging and headless assertions.
   *
   * Child nodes serialize recursively, bindings as their snapshot values,
   * and action closures as the string `'<Action>'`.
   *
   * @returns Serialized JSON-compatible representation.
   */
  toJSON(): Record<string, unknown>;
}

/**
 * Narrows an unknown value to a `ComponentNode`.
 *
 * @param value The value to inspect.
 * @returns Whether the value is a `ComponentNode`.
 */
export function isComponentNode(value: unknown): value is ComponentNode {
  return value instanceof MutableComponentNode;
}

/**
 * Mutable implementation of `ComponentNode`.
 *
 * Used internally by the node resolver to construct, update, and dispose nodes.
 */
export class MutableComponentNode<TProps extends NodeProps = NodeProps> implements ComponentNode<
  ComponentApi,
  TProps
> {
  readonly instanceId: string;
  readonly componentId: string;
  readonly type: string;
  readonly dataPath: string;
  readonly impl: ComponentApi | undefined;
  readonly state: NodeState;
  readonly props: Signal<TProps>;

  private readonly _onDestroyed = new EventEmitter<void>();
  readonly onDestroyed: EventSource<void> = this._onDestroyed;

  private cleanups: Array<() => void> = [];
  private _disposed = false;

  /**
   * Creates a new `MutableComponentNode` instance.
   *
   * @param instanceId Unique instance identifier in the tree.
   * @param componentId The component ID from the payload.
   * @param type The component type name.
   * @param dataPath Data model scope path.
   * @param initialProps Initial resolved properties.
   * @param impl Optional catalog component definition.
   * @param state Initial resolution state.
   */
  constructor(
    instanceId: string,
    componentId: string,
    type: string,
    dataPath: string,
    initialProps: TProps,
    impl?: ComponentApi,
    state: NodeState = 'resolved',
  ) {
    this.instanceId = instanceId;
    this.componentId = componentId;
    this.type = type;
    this.dataPath = dataPath;
    this.props = signal(initialProps);
    this.impl = impl;
    this.state = state;
  }

  /** Whether this node has been disposed. */
  get disposed(): boolean {
    return this._disposed;
  }

  /** Whether this node is an unresolved placeholder. */
  get isPlaceholder(): boolean {
    return this.state !== 'resolved';
  }

  /**
   * Registers teardown work to run when this node is disposed.
   *
   * @param cleanup Teardown callback.
   */
  addCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  /**
   * Serializes the resolved tree for debugging and headless assertions.
   *
   * @returns Serialized JSON-compatible representation.
   */
  toJSON(): Record<string, unknown> {
    if (this.isPlaceholder) {
      return {id: this.componentId, type: this.type, state: this.state};
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

  /**
   * Replaces resolved properties, emitting only when a shallow comparison detects a change.
   *
   * @param next Next property dictionary.
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
   * Tears down this node by running cleanups and firing destruction events.
   *
   * This operation is idempotent.
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
}

function serializeValue(value: unknown): unknown {
  if (isComponentNode(value)) {
    return value.toJSON();
  }
  if (value instanceof ResolvedBinding) {
    return serializeValue(value.value);
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
