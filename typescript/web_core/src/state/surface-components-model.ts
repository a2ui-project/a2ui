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

import {ComponentModel} from './component-model.js';
import {EventEmitter, EventSource} from '../common/events.js';
import {
  A2uiIntegrityError,
  A2uiRecursionError,
  A2uiStateError,
  A2uiValidationError,
} from '../errors.js';
import {Catalog} from '../catalog/types.js';
import {
  buildComponentRefMap,
  ComponentRefMap,
  getComponentReferences,
  MAX_GLOBAL_DEPTH,
} from '../validating/integrity-checker.js';
import {ValidationConfig} from '../validating/validator.js';

/**
 * Manages the collection of components for a specific surface and performs
 * inlined graph topology, cycle detection, and completeness validation.
 */
export class SurfaceComponentsModel {
  private components: Map<string, ComponentModel> = new Map();
  private refMap?: ComponentRefMap;
  private static readonly refMapCache = new WeakMap<Catalog<any, any>, ComponentRefMap>();

  private static getOrCreateRefMap(catalog: Catalog<any, any>): ComponentRefMap {
    let map = SurfaceComponentsModel.refMapCache.get(catalog);
    if (!map) {
      map = buildComponentRefMap(catalog);
      SurfaceComponentsModel.refMapCache.set(catalog, map);
    }
    return map;
  }

  private readonly _onCreated = new EventEmitter<ComponentModel>();
  private readonly _onDeleted = new EventEmitter<string>();

  /** Fires when a new component is added to the model. */
  readonly onCreated: EventSource<ComponentModel> = this._onCreated;
  /** Fires when a component is removed, providing the ID of the deleted component. */
  readonly onDeleted: EventSource<string> = this._onDeleted;

  /**
   * Creates a new SurfaceComponentsModel instance.
   *
   * @param catalogOrRefMap Optional Catalog or precomputed ComponentRefMap used for schema-driven child reference extraction.
   */
  constructor(catalogOrRefMap?: Catalog<any, any> | ComponentRefMap) {
    if (catalogOrRefMap) {
      this.setCatalog(catalogOrRefMap);
    }
  }

  /**
   * Associates a catalog or reference map with this model for schema-driven child detection.
   *
   * @param catalogOrRefMap Catalog instance or ComponentRefMap.
   */
  setCatalog(catalogOrRefMap: Catalog<any, any> | ComponentRefMap): void {
    this.refMap =
      catalogOrRefMap instanceof Catalog
        ? SurfaceComponentsModel.getOrCreateRefMap(catalogOrRefMap)
        : catalogOrRefMap;
  }

  /**
   * Retrieves a component by its ID.
   *
   * @param id The ID of the component to retrieve.
   * @returns The component model, or undefined if not found.
   */
  get(id: string): ComponentModel | undefined {
    return this.components.get(id);
  }

  /**
   * Returns a copy of the component map.
   */
  getAll(): Map<string, ComponentModel> {
    return new Map(this.components);
  }

  /**
   * Checks if a component with the specified ID exists in the model.
   */
  has(id: string): boolean {
    return this.components.has(id);
  }

  /**
   * Returns an iterator over the components in the model.
   */
  get entries(): IterableIterator<[string, ComponentModel]> {
    return this.components.entries();
  }

  get keys(): IterableIterator<string> {
    return this.components.keys();
  }

  get values(): IterableIterator<ComponentModel> {
    return this.components.values();
  }

  get size(): number {
    return this.components.size;
  }

  /**
   * Adds a component to the model.
   * Throws an error if a component with the same ID already exists.
   *
   * @param component The component to add.
   */
  addComponent(component: ComponentModel): void {
    if (this.components.has(component.id)) {
      throw new A2uiStateError(`Component with id '${component.id}' already exists.`);
    }

    this.components.set(component.id, component);
    this._onCreated.emit(component);
  }

  /**
   * Removes a component from the model by its ID.
   * Disposes of the component upon removal.
   *
   * @param id The ID of the component to remove.
   */
  removeComponent(id: string): void {
    const component = this.components.get(id);
    if (component) {
      this.components.delete(id);
      component.dispose();
      this._onDeleted.emit(id);
    }
  }

  /**
   * Extracts child component references for a given component identifier.
   *
   * @param componentId The ID of the component whose children should be resolved.
   * @returns Array of tuples containing `[referencedId, propertyPath]`.
   */
  getChildReferences(componentId: string): Array<[referencedId: string, propertyPath: string]> {
    const comp = this.components.get(componentId);
    if (!comp) return [];

    const refMap: ComponentRefMap =
      (comp.catalog ? SurfaceComponentsModel.getOrCreateRefMap(comp.catalog) : this.refMap) ?? {};

    return Array.from(
      getComponentReferences({id: comp.id, component: comp.type, ...comp.properties}, refMap),
    );
  }

  /**
   * Returns array of referenced child component IDs for a given component identifier.
   *
   * @param componentId The ID of the component whose child IDs should be retrieved.
   * @returns Array of unique child component IDs.
   */
  getChildIds(componentId: string): string[] {
    return this.getChildReferences(componentId).map(([refId]) => refId);
  }

  /**
   * Detects self-references, circular dependencies, and exceeds depth limits via DFS.
   *
   * @param options Configuration specifying root node, max depth, or allowing missing root.
   * @returns Set of visited component identifiers.
   * @throws {A2uiRecursionError} When self-reference, cycle, or max depth limit is exceeded.
   */
  detectCycles(
    options: {rootId?: string; maxDepth?: number; allowMissingRoot?: boolean} = {},
  ): Set<string> {
    const rootId = options.rootId ?? 'root';
    const maxDepth = options.maxDepth ?? MAX_GLOBAL_DEPTH;
    const allowMissingRoot = options.allowMissingRoot ?? false;

    // 1. Check for immediate self-references across all components
    for (const comp of this.components.values()) {
      for (const [childId, fieldName] of this.getChildReferences(comp.id)) {
        if (childId === comp.id) {
          throw new A2uiRecursionError(
            `Circular reference detected: Component '${comp.id}' references itself in field '${fieldName}' (Self-reference detected)`,
          );
        }
      }
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, depth: number) => {
      if (depth > maxDepth) {
        throw new A2uiRecursionError(
          `Global recursion limit exceeded: logical depth > ${maxDepth}`,
        );
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const childIds = this.getChildIds(nodeId);
      for (const childId of childIds) {
        if (!this.components.has(childId)) {
          continue;
        }
        if (!visited.has(childId)) {
          dfs(childId, depth + 1);
        } else if (recursionStack.has(childId)) {
          throw new A2uiRecursionError(
            `Circular reference detected involving component '${childId}'`,
          );
        }
      }

      recursionStack.delete(nodeId);
    };

    if (allowMissingRoot) {
      const sortedIds = Array.from(this.components.keys()).sort();
      for (const nodeId of sortedIds) {
        if (!visited.has(nodeId)) {
          dfs(nodeId, 0);
        }
      }
    } else {
      if (this.components.has(rootId)) {
        dfs(rootId, 0);
      }
    }

    return visited;
  }

  /**
   * Validates topology, completeness, and references across the component hierarchy.
   *
   * @param options Validation settings (allowMissingRoot, allowDanglingReferences, allowOrphanComponents).
   * @throws {A2uiIntegrityError} If missing root, dangling references, or orphan components exist.
   * @throws {A2uiRecursionError} If self-reference, cycle, or depth limit is detected.
   */
  validateTopology(options: ValidationConfig = {}): void {
    if (this.components.size === 0) return;

    const rootId = options.rootId ?? 'root';
    const allowMissingRoot = options.allowMissingRoot ?? false;
    const allowDanglingReferences = options.allowDanglingReferences ?? false;
    const allowOrphanComponents = options.allowOrphanComponents ?? false;

    // 1. Missing Root Check
    if (!allowMissingRoot && !this.components.has(rootId)) {
      throw new A2uiIntegrityError(`Missing root component: No component has id='${rootId}'`);
    }

    // 2. Dangling References Check
    if (!allowDanglingReferences) {
      for (const comp of this.components.values()) {
        for (const [childId, fieldName] of this.getChildReferences(comp.id)) {
          if (!this.components.has(childId)) {
            throw new A2uiIntegrityError(
              `Component '${comp.id}' references non-existent component '${childId}' in field '${fieldName}' (Dangling reference '${childId}' in component '${comp.id}')`,
            );
          }
        }
      }
    }

    // 3. Cycle & Depth Detection
    const visited = this.detectCycles({rootId, allowMissingRoot, maxDepth: options.maxDepth});

    // 4. Orphan Components Check
    if (!allowOrphanComponents && !allowMissingRoot) {
      if (visited.size < this.components.size) {
        const orphans = Array.from(this.components.keys())
          .filter(id => !visited.has(id))
          .sort();
        if (orphans.length > 0) {
          throw new A2uiIntegrityError(
            `Component '${orphans[0]}' is not reachable from '${rootId}' (Orphaned component '${orphans[0]}' is not reachable from root)`,
          );
        }
      }
    }
  }

  /**
   * Performs non-throwing validation of references and topology across the component graph.
   * Returns an array containing the first validation error encountered, or an empty array if valid.
   *
   * @param options Validation options.
   * @returns Array of validation error objects.
   */
  validateReferences(options: ValidationConfig = {}): A2uiValidationError[] {
    const errors: A2uiValidationError[] = [];
    try {
      this.validateTopology(options);
    } catch (err) {
      if (err instanceof A2uiValidationError) {
        errors.push(err);
      } else if (err instanceof Error) {
        errors.push(new A2uiValidationError(err.message));
      }
    }
    return errors;
  }

  /**
   * Disposes of the model and all its components.
   */
  dispose(): void {
    for (const component of this.components.values()) {
      component.dispose();
    }
    this.components.clear();
    this._onCreated.dispose();
    this._onDeleted.dispose();
  }
}
