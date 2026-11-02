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

import {Catalog} from '../catalog/types.js';
import {Subscription} from '../common/events.js';
import {ComponentModel} from './component-model.js';
import {SurfaceComponentsModel} from './surface-components-model.js';

/**
 * What a check found about a surface's component graph, which had no
 * self-reference and no cycle: the references each component holds, the
 * components that reference each id, and an upper bound on the longest chain
 * of references below each component.
 *
 * The bound lets `MessageProcessor` check an `updateComponents` without
 * walking the whole surface again when its validation config leaves the
 * reference and reachability checks to a later point. A cycle the batch makes
 * passes through one of its components, and only the chains through its
 * components grow, so only those components and the ones above them are
 * revisited.
 *
 * This is the TypeScript form of the bound the Dart `SurfaceComponentsModel`
 * keeps (dart/a2ui_core/lib/src/core/component_graph_bound.dart).
 */
export class ComponentGraphBound {
  /** The ids each component references, held or not, in order. */
  private readonly children = new Map<string, readonly string[]>();

  /** The components that reference each id, held or not. */
  private readonly parents = new Map<string, Set<string>>();

  /** For each component, at least the number of references in the longest chain below it. */
  private readonly heights = new Map<string, number>();

  /** At least the largest of `heights`. */
  private maxHeight = 0;

  private constructor() {}

  /**
   * Builds the bound of a graph.
   *
   * @param graph Each component id with the ids it references, held or not.
   * @returns The bound, or undefined when the graph holds a cycle, which a
   *     graph may hold and still pass a check that starts only at the root.
   */
  static of(graph: ReadonlyMap<string, readonly string[]>): ComponentGraphBound | undefined {
    const bound = new ComponentGraphBound();
    for (const [id, children] of graph) {
      bound.setChildren(id, children);
    }
    // Children before parents. A component waits on the stack until its
    // children have their heights; meeting one that is still waiting means a
    // cycle.
    const waiting = new Set<string>();
    for (const start of graph.keys()) {
      if (bound.heights.has(start)) continue;
      const stack: Array<{id: string; childIndex: number; height: number}> = [
        {id: start, childIndex: 0, height: 0},
      ];
      waiting.add(start);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const children = bound.children.get(frame.id) ?? [];
        let ready = true;
        while (frame.childIndex < children.length) {
          const child = children[frame.childIndex];
          frame.childIndex++;
          if (!graph.has(child)) continue;
          const below = bound.heights.get(child);
          if (below === undefined) {
            if (waiting.has(child)) return undefined;
            frame.childIndex--;
            stack.push({id: child, childIndex: 0, height: 0});
            waiting.add(child);
            ready = false;
            break;
          }
          if (below >= frame.height) frame.height = below + 1;
        }
        if (!ready) continue;
        bound.heights.set(frame.id, frame.height);
        if (frame.height > bound.maxHeight) bound.maxHeight = frame.height;
        waiting.delete(frame.id);
        stack.pop();
      }
    }
    return bound;
  }

  /** The ids the component `id` references, held or not, in order. */
  childrenOf(id: string): readonly string[] {
    return this.children.get(id) ?? [];
  }

  /** The components that reference `id`. */
  parentsOf(id: string): ReadonlySet<string> {
    return this.parents.get(id) ?? new Set();
  }

  private setChildren(id: string, children: readonly string[]): void {
    for (const child of this.children.get(id) ?? []) {
      this.parents.get(child)?.delete(id);
    }
    for (const child of children) {
      let parents = this.parents.get(child);
      if (!parents) {
        parents = new Set();
        this.parents.set(child, parents);
      }
      parents.add(id);
    }
    this.children.set(id, children);
  }

  /**
   * Updates the bound to the graph with `batch` applied, and tells whether it
   * shows that graph has no self-reference, no cycle and no chain of more
   * than `limit` references.
   *
   * The references and parents are updated whatever the answer, so
   * `childrenOf` and `parentsOf` describe the graph with the batch applied.
   * False means the bound cannot show the graph passes, not that it fails,
   * and leaves the heights unusable.
   *
   * @param batch Each component of the batch with the ids it references.
   * @param limit The longest chain allowed.
   * @param held Whether the graph holds an id before the batch.
   */
  admits(
    batch: ReadonlyMap<string, readonly string[]>,
    limit: number,
    held: (id: string) => boolean,
  ): boolean {
    for (const [id, children] of batch) {
      this.setChildren(id, children);
    }
    if (this.maxHeight > limit) return false;
    for (const [id, children] of batch) {
      if (children.includes(id)) return false;
    }
    const holds = (id: string) => batch.has(id) || held(id);

    // Raises the bound of each component above one whose bound rose, until
    // none rises. A cycle would raise its bounds past any limit.
    const rising: string[] = [];
    for (const [id, children] of batch) {
      let height = 0;
      for (const child of children) {
        const below = this.heights.get(child) ?? 0;
        if (holds(child) && below >= height) height = below + 1;
      }
      this.heights.set(id, height);
      rising.push(id);
    }
    for (let next = 0; next < rising.length; next++) {
      const id = rising[next];
      const height = this.heights.get(id) ?? 0;
      if (height > limit) return false;
      if (height > this.maxHeight) this.maxHeight = height;
      for (const parent of this.parents.get(id) ?? []) {
        if ((this.heights.get(parent) ?? 0) <= height) {
          this.heights.set(parent, height + 1);
          rising.push(parent);
        }
      }
    }
    return true;
  }
}

/**
 * Follows the components of a `SurfaceComponentsModel`, whoever changes them:
 * it counts the changes (a component added or removed, or a component's
 * properties replaced) and collects the catalogs of the components added.
 *
 * A `ComponentGraphBound` describes the components as they were when it was
 * recorded, and holds only while the count is the same.
 */
export class ComponentsWatcher {
  private count = 0;
  private readonly seenCatalogs = new Set<Catalog<any, any>>();

  private constructor() {}

  /** The watcher of `model`, which starts following it on first use. */
  static of(model: SurfaceComponentsModel): ComponentsWatcher {
    let watcher = watchers.get(model);
    if (!watcher) {
      watcher = new ComponentsWatcher();
      watcher.watch(model);
      watchers.set(model, watcher);
    }
    return watcher;
  }

  /** How many changes have been counted. */
  get changes(): number {
    return this.count;
  }

  /**
   * The catalogs of every component the model has held since the watcher
   * started, including components since removed.
   */
  get catalogs(): ReadonlySet<Catalog<any, any>> {
    return this.seenCatalogs;
  }

  private watch(model: SurfaceComponentsModel): void {
    const updates = new Map<string, Subscription>();
    const bump = () => {
      this.count++;
    };
    const follow = (component: ComponentModel) => {
      this.seenCatalogs.add(component.catalog);
      updates.get(component.id)?.unsubscribe();
      updates.set(component.id, component.onUpdated.subscribe(bump));
    };
    for (const component of model.values) {
      follow(component);
    }
    model.onCreated.subscribe(component => {
      this.count++;
      follow(component);
    });
    model.onDeleted.subscribe(id => {
      this.count++;
      updates.get(id)?.unsubscribe();
      updates.delete(id);
    });
  }
}

const watchers = new WeakMap<SurfaceComponentsModel, ComponentsWatcher>();
