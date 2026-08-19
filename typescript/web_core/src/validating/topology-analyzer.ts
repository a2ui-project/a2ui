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

import {A2uiIntegrityError, A2uiRecursionError} from '../errors.js';
import {
  ComponentRefMap,
  getComponentReferences,
  MAX_GLOBAL_DEPTH,
  STANDARD_REF_MAP,
} from './integrity-checker.js';

/** Configuration options for component topology analysis. */
export interface TopologyOptions {
  /** Expected root component identifier. Defaults to 'root'. */
  rootId?: string;
  /** Whether to allow components that are not reachable from the root node. */
  allowOrphanComponents?: boolean;
  /** Whether to perform analysis when the root component is absent. */
  allowMissingRoot?: boolean;
}

function dfsTopology(
  nodeId: string,
  depth: number,
  adjList: Record<string, string[]>,
  visited: Set<string>,
  recursionStack: Set<string>,
): void {
  if (depth > MAX_GLOBAL_DEPTH) {
    throw new A2uiRecursionError(
      `Global recursion limit exceeded: logical depth > ${MAX_GLOBAL_DEPTH}`,
    );
  }

  visited.add(nodeId);
  recursionStack.add(nodeId);

  const neighbors = adjList[nodeId] ?? [];
  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      dfsTopology(neighbor, depth + 1, adjList, visited, recursionStack);
    } else if (recursionStack.has(neighbor)) {
      throw new A2uiRecursionError(`Circular reference detected involving component '${neighbor}'`);
    }
  }

  recursionStack.delete(nodeId);
}

/**
 * Analyzes the graph topology of a component tree to detect cycles, self-references, and orphans.
 *
 * @param components List of component definition objects forming the graph.
 * @param refFieldsMap Mapping of reference property names per component type.
 * @param options Topology evaluation options.
 * @returns Set of all component identifiers visited during graph traversal.
 * @throws {A2uiRecursionError} If a self-reference, circular dependency, or excessive depth is detected.
 * @throws {A2uiIntegrityError} If unreachable orphan components exist when prohibited.
 *
 * @example
 * ```ts
 * const visitedIds = analyzeTopology(components, STANDARD_REF_MAP, { allowOrphanComponents: false });
 * ```
 */
export function analyzeTopology(
  components: Array<Record<string, any>>,
  refFieldsMap: ComponentRefMap = STANDARD_REF_MAP,
  options: TopologyOptions = {},
): Set<string> {
  const rootId = options.rootId ?? 'root';
  const allowOrphanComponents = options.allowOrphanComponents ?? false;
  const allowMissingRoot = options.allowMissingRoot ?? false;

  const adjList: Record<string, string[]> = {};
  const allIds = new Set<string>();

  // 1. Build Adjacency List
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const compId = comp.id;
    if (compId === undefined || compId === null) continue;

    const compIdStr = String(compId);
    allIds.add(compIdStr);
    if (!adjList[compIdStr]) {
      adjList[compIdStr] = [];
    }

    for (const [refId, fieldName] of getComponentReferences(comp, refFieldsMap)) {
      if (refId === compIdStr) {
        throw new A2uiRecursionError(
          `Self-reference detected: Component '${compIdStr}' references itself in field '${fieldName}'`,
        );
      }
      adjList[compIdStr].push(refId);
    }
  }

  // 2. Detect Cycles and Depth via DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  if (allowMissingRoot) {
    const sortedIds = Array.from(allIds).sort();
    for (const nodeId of sortedIds) {
      if (!visited.has(nodeId)) {
        dfsTopology(nodeId, 0, adjList, visited, recursionStack);
      }
    }
  } else {
    if (allIds.has(rootId)) {
      dfsTopology(rootId, 0, adjList, visited, recursionStack);
    }

    if (!allowOrphanComponents) {
      const orphans = Array.from(allIds).filter(id => !visited.has(id));
      if (orphans.length > 0) {
        orphans.sort();
        throw new A2uiIntegrityError(`Component '${orphans[0]}' is not reachable from '${rootId}'`);
      }
    }
  }

  return visited;
}
