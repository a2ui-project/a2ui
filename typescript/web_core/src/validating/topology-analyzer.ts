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

export interface TopologyOptions {
  rootId?: string;
  allowOrphanComponents?: boolean;
  allowMissingRoot?: boolean;
}

/**
 * Analyzes the graph topology of a component tree to detect cycles, self-references, and orphans.
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
    const compId = comp.id;
    if (compId === undefined || compId === null) continue;

    allIds.add(compId);
    if (!adjList[compId]) {
      adjList[compId] = [];
    }

    for (const [refId, fieldName] of getComponentReferences(comp, refFieldsMap)) {
      if (refId === compId) {
        throw new A2uiRecursionError(
          `Self-reference detected: Component '${compId}' references itself in field '${fieldName}'`,
        );
      }
      adjList[compId].push(refId);
    }
  }

  // 2. Detect Cycles and Depth via DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(nodeId: string, depth: number): void {
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
        dfs(neighbor, depth + 1);
      } else if (recursionStack.has(neighbor)) {
        throw new A2uiRecursionError(
          `Circular reference detected involving component '${neighbor}'`,
        );
      }
    }

    recursionStack.delete(nodeId);
  }

  if (allowMissingRoot) {
    const sortedIds = Array.from(allIds).sort();
    for (const nodeId of sortedIds) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, 0);
      }
    }
  } else {
    if (allIds.has(rootId)) {
      dfs(rootId, 0);
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
