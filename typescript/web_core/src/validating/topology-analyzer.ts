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

import {A2uiIntegrityError} from '../errors.js';
import {Catalog} from '../catalog/types.js';
import {ComponentRefMap} from './integrity-checker.js';
import {SurfaceComponentsModel} from '../state/surface-components-model.js';
import {ComponentModel} from '../state/component-model.js';

/** Configuration options for component topology analysis. */
export interface TopologyOptions {
  /** Expected root component identifier. Defaults to 'root'. */
  rootId?: string;
  /** Whether to allow components that are not reachable from the root node. */
  allowOrphanComponents?: boolean;
  /** Whether to perform analysis when the root component is absent. */
  allowMissingRoot?: boolean;
}

/**
 * Analyzes the graph topology of a component tree to detect cycles, self-references, and orphans.
 * Delegates directly to SurfaceComponentsModel for graph and topology evaluation.
 *
 * @param components List of component definition objects forming the graph.
 * @param catalogOrRefMap Mapping of reference property names per component type or Catalog instance.
 * @param options Topology evaluation options.
 * @returns Set of all component identifiers visited during graph traversal.
 * @throws {A2uiRecursionError} If a self-reference, circular dependency, or excessive depth is detected.
 * @throws {A2uiIntegrityError} If unreachable orphan components exist when prohibited.
 *
 * @example
 * ```ts
 * const visitedIds = analyzeTopology(components, catalog, { allowOrphanComponents: false });
 * ```
 */
export function analyzeTopology(
  components: Array<Record<string, any>>,
  catalogOrRefMap: Catalog<any> | ComponentRefMap,
  options: TopologyOptions = {},
): Set<string> {
  const model = new SurfaceComponentsModel(catalogOrRefMap);
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const compId = comp.id !== undefined && comp.id !== null ? String(comp.id) : undefined;
    if (!compId) continue;

    let compType = '';
    let props: Record<string, any> = comp;
    if (typeof comp.component === 'string') {
      compType = comp.component;
    } else if (typeof comp.component === 'object' && comp.component !== null) {
      compType = Object.keys(comp.component)[0] ?? '';
      props = comp.component[compType] ?? {};
    }

    model.addComponent(new ComponentModel(compId, compType, props));
  }

  const visited = model.detectCycles({
    rootId: options.rootId,
    allowMissingRoot: options.allowMissingRoot,
  });

  if (!options.allowOrphanComponents && !options.allowMissingRoot) {
    const rootId = options.rootId ?? 'root';
    if (visited.size < model.size) {
      const orphans = Array.from(model.keys)
        .filter(id => !visited.has(id))
        .sort();
      if (orphans.length > 0) {
        throw new A2uiIntegrityError(`Component '${orphans[0]}' is not reachable from '${rootId}'`);
      }
    }
  }

  return visited;
}
