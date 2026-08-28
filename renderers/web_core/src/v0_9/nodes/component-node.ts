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

import {EventEmitter, EventSource} from '../common/events.js';
import type {ComponentApi} from '../catalog/types.js';
import {Signal, signal, peekValue, setValue} from '../reactivity/signals.js';
import {ResolvedBinding} from './resolved-binding.js';

/** The `type` of pending and cyclic stand-in nodes. */
export const PLACEHOLDER_TYPE = 'Placeholder';

/**
 * Why a node is or is not resolved:
 *
 * - `resolved`: a real component with a catalog entry; `impl` is set.
 * - `pending`: the component definition has not arrived; upgraded in place
 *   when it does.
 * - `unknown-type`: the definition arrived but its type has no catalog
 *   entry; `UNKNOWN_COMPONENT_TYPE` is reported once per component and
 *   data path.
 * - `cyclic`: the reference repeats one of the node's own ancestors;
 *   `CYCLIC_REFERENCE` is reported once per component and data path.
 */
export type NodeState = 'resolved' | 'pending' | 'unknown-type' | 'cyclic';

/** Resolved node properties, keyed by the component's schema property names. */
export type NodeProps = Record<string, unknown>;

/**
 * One resolved component instance in the rendered tree.
 *
 * A node's `props` hold fully resolved values: `ResolvedBinding`s for
 * dynamic values, ready-to-call `() => void` closures for actions, and live
 * `ComponentNode` references (or arrays of them) for child properties.
 *
 * Emission contract: `props` emits when this node's own resolved properties
 * change, including when a child *reference* is replaced (a placeholder
 * upgrade, a deletion, a list change). It does not emit when a child's
 * internal properties change; subscribe to the child's `props` for that.
 *
 * The resolver creates, updates, and disposes nodes; application code reads
 * them through this interface. {@link MutableComponentNode} is the only
 * implementation.
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
  readonly disposed: boolean;
  /**
   * True for any unresolved stand-in (`state` other than `resolved`). A
   * placeholder holds the child position with empty props; when its
   * component becomes resolvable, the resolver replaces it in place with a
   * real node and the parent emits once.
   */
  readonly isPlaceholder: boolean;
  /** Registers teardown work to run when this node is disposed. */
  addCleanup(cleanup: () => void): void;
  /**
   * Serializes the resolved tree for debugging and headless assertions.
   * Child nodes serialize recursively, bindings as their snapshot values,
   * and action closures as the string `'<Action>'`.
   */
  toJSON(): Record<string, unknown>;
}

/** Narrows an unknown prop value to a {@link ComponentNode}. */
export function isComponentNode(value: unknown): value is ComponentNode {
  return value instanceof MutableComponentNode;
}

/**
 * The write side and only implementation of {@link ComponentNode}. Not
 * exported from the package barrel: the resolver constructs, updates, and
 * disposes nodes; application code sees the read-only interface.
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

  get disposed(): boolean {
    return this._disposed;
  }

  get isPlaceholder(): boolean {
    return this.state !== 'resolved';
  }

  addCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

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
   * Replaces the resolved props, emitting only if a shallow comparison shows
   * a change. Callers must keep unchanged values reference-identical; the
   * shallow comparison is exact only under that invariant.
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
