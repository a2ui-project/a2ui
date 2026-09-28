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
 * The React host elements currently connected for one surface, each with its
 * node. Hosts add themselves once connected and given a node, wherever they
 * are in the DOM; `A2uiSurface` subscribes and renders a portal into each one.
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

  private readonly hosts = new Map<ReactHostElement, ComponentNode<ReactComponentImplementation>>();
  private snapshot: readonly HostEntry[] = [];
  private readonly listeners = new Set<() => void>();

  add(host: ReactHostElement, node: ComponentNode<ReactComponentImplementation>): void {
    if (this.hosts.get(host) === node) return;
    this.hosts.set(host, node);
    this.publish();
  }

  delete(host: ReactHostElement): void {
    if (this.hosts.delete(host)) this.publish();
  }

  has(host: ReactHostElement): boolean {
    return this.hosts.has(host);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): readonly HostEntry[] => this.snapshot;

  private publish(): void {
    this.snapshot = [...this.hosts].map(([host, node]) => ({host, node}));

    for (const listener of this.listeners) listener();
  }
}
