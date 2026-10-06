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

import type {ComponentApi, ComponentNode, SurfaceModel} from '@a2ui/web_core/v0_9';
import type {ReactHostElement} from './catalog/react_host_element';
import type {ReactComponentImplementation} from './react_component_implementation';

/** A connected host and the node it currently holds. */
export interface HostEntry {
  readonly host: ReactHostElement;
  readonly node: ComponentNode<ReactComponentImplementation>;
}

/**
 * Identifies an element that React rendered through `WebComponentNode`. The
 * React content rendered beside that element portals the hosts it owns: the
 * React hosts another renderer (a Lit `Column`, say) created below it.
 */
export class HostOwner {
  // Nominal: only `new HostOwner()` is one.
  declare private readonly nominal: never;
}

const rendered = new WeakMap<Element, HostOwner>();

/** Records that React rendered `element`, under the identity `owner`. */
export function markReactRendered(element: Element, owner: HostOwner): void {
  rendered.set(element, owner);
}

/**
 * Whether React rendered `element`. React renders the content of a host it
 * created as the host's children; only a host another renderer created is
 * portaled.
 */
export function isReactRendered(element: Element): boolean {
  return rendered.has(element);
}

/**
 * The owner of the nearest element above `element` that React rendered,
 * crossing shadow roots; `null` when there is none.
 */
export function ownerAbove(element: Element): HostOwner | null {
  let current: Node | null = element.parentNode;
  while (current) {
    const owner = current instanceof Element ? rendered.get(current) : undefined;
    if (owner) return owner;
    current = current instanceof ShadowRoot ? current.host : current.parentNode;
  }
  return null;
}

/**
 * The React hosts currently connected for one surface that another renderer
 * created, each with its node and its owner (see `HostOwner`). The owner's
 * content portals the entry, so the React tree nests the way the DOM does.
 */
export class HostRegistry {
  private static readonly registries = new WeakMap<SurfaceModel<ComponentApi>, HostRegistry>();

  /** The registry of `surface`; hosts find it through their node's context. */
  static forSurface(surface: SurfaceModel<ComponentApi>): HostRegistry {
    let registry = HostRegistry.registries.get(surface);
    if (!registry) {
      registry = new HostRegistry();
      HostRegistry.registries.set(surface, registry);
    }
    return registry;
  }

  private readonly hosts = new Map<ReactHostElement, {entry: HostEntry; owner: HostOwner | null}>();
  private readonly snapshots = new Map<HostOwner | null, readonly HostEntry[]>();
  private readonly listeners = new Map<HostOwner | null, Set<() => void>>();

  add(
    host: ReactHostElement,
    node: ComponentNode<ReactComponentImplementation>,
    owner: HostOwner | null,
  ): void {
    const current = this.hosts.get(host);
    if (current && current.entry.node === node && current.owner === owner) return;
    this.hosts.set(host, {entry: {host, node}, owner});
    if (current && current.owner !== owner) this.publish(current.owner);
    this.publish(owner);
  }

  delete(host: ReactHostElement): void {
    const current = this.hosts.get(host);
    if (!current) return;
    this.hosts.delete(host);
    this.publish(current.owner);
  }

  has(host: ReactHostElement): boolean {
    return this.hosts.has(host);
  }

  /** Every registered host, in registration order. */
  entries(): readonly HostEntry[] {
    return [...this.hosts.values()].map(({entry}) => entry);
  }

  /** Notifies `listener` when the hosts owned by `owner` change. */
  subscribe(owner: HostOwner | null, listener: () => void): () => void {
    let listeners = this.listeners.get(owner);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(owner, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** The hosts owned by `owner`; the same array until they change. */
  getSnapshot(owner: HostOwner | null): readonly HostEntry[] {
    let snapshot = this.snapshots.get(owner);
    if (!snapshot) {
      snapshot = this.compute(owner);
      this.snapshots.set(owner, snapshot);
    }
    return snapshot;
  }

  private compute(owner: HostOwner | null): readonly HostEntry[] {
    const result: HostEntry[] = [];
    for (const {entry, owner: entryOwner} of this.hosts.values()) {
      if (entryOwner === owner) result.push(entry);
    }
    return result;
  }

  private publish(owner: HostOwner | null): void {
    this.snapshots.set(owner, this.compute(owner));
    for (const listener of this.listeners.get(owner) ?? []) listener();
  }
}
