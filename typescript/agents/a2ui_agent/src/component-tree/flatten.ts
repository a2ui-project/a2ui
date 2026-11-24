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

import {ComponentChild, ComponentNode, FlatComponent, isComponentNode} from './component-node.js';
import {IdAllocator} from './id-allocator.js';

/** Options for `flattenComponentTree`. */
export interface FlattenComponentTreeOptions {
  /**
   * The ID of the root component, and the prefix of every other ID in the tree. Defaults
   * to the root's own `id`; without one, the prefix is `root` and the root's ID is
   * allocated like any other.
   */
  rootId?: string;
}

/**
 * Flattens a nested component tree into the flat component list of `updateComponents`.
 *
 * Descendants are listed before their parents, so the root comes last. Nested nodes are
 * replaced by their IDs, and ID references are kept as written. A descendant without an
 * `id` gets `<prefix>__<component>_<n>`; one with an `id` gets `<prefix>__<id>`, and no
 * allocated ID ever takes the place of an ID the author set. A node that appears in two
 * places is listed once and referenced from both. Properties set to `undefined` are left
 * out.
 *
 * An array of roots flattens each root on its own, with the prefix `<rootId>_<index>`
 * when `rootId` is given. A root that is an ID reference adds nothing.
 */
export function flattenComponentTree(
  root: ComponentChild | readonly ComponentChild[],
  options: FlattenComponentTreeOptions = {},
): FlatComponent[] {
  const {rootId} = options;
  if (Array.isArray(root)) {
    return root.flatMap((item, index) =>
      flattenComponentTree(item, {rootId: rootId ? `${rootId}_${index}` : undefined}),
    );
  }
  if (!isComponentNode(root)) {
    return [];
  }

  const prefix = rootId || root.id || 'root';
  const reserved = reservedIds(root, prefix);
  if (rootId) {
    reserved.add(rootId);
  }
  const flattener = new TreeFlattener(new IdAllocator(prefix, reserved));
  return flattener.flatten(root, rootId || root.id);
}

/** The IDs the authors set anywhere in the tree, bare and namespaced. */
function reservedIds(root: ComponentNode, prefix: string): Set<string> {
  const reserved = new Set<string>();
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || visited.has(value)) {
      return;
    }
    visited.add(value);
    if (isComponentNode(value) && value.id) {
      reserved.add(value.id);
      reserved.add(`${prefix}__${value.id}`);
    }
    for (const nested of Object.values(value)) {
      visit(nested);
    }
  };
  visit(root);
  return reserved;
}

class TreeFlattener {
  private readonly components: FlatComponent[] = [];
  private readonly assigned = new Map<ComponentNode, string>();

  constructor(private readonly allocator: IdAllocator) {}

  flatten(root: ComponentNode, rootId: string | undefined): FlatComponent[] {
    const id = rootId || this.allocator.allocate(root.component);
    this.assigned.set(root, id);
    this.components.push(this.toFlatComponent(root, id));
    return this.components;
  }

  private emit(node: ComponentNode): string {
    const assigned = this.assigned.get(node);
    if (assigned !== undefined) {
      return assigned;
    }
    // Allocated before the descendants' IDs: counters run in pre-order while the list is
    // in post-order, which the conformance goldens pin.
    const id = this.allocator.allocate(node.component, node.id);
    this.assigned.set(node, id);
    this.components.push(this.toFlatComponent(node, id));
    return id;
  }

  private toFlatComponent(node: ComponentNode, id: string): FlatComponent {
    const flat: FlatComponent = {component: node.component, id};
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'component' && key !== 'id' && value !== undefined) {
        flat[key] = this.toWireValue(value);
      }
    }
    return flat;
  }

  private toWireValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.toWireValue(item));
    }
    if (isComponentNode(value)) {
      return this.emit(value);
    }
    if (typeof value === 'object' && value !== null) {
      const wire: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        if (nested !== undefined) {
          wire[key] = this.toWireValue(nested);
        }
      }
      return wire;
    }
    return value;
  }
}
