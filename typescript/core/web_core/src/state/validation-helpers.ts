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

import {Catalog, ComponentApi} from '../catalog/types.js';
import {A2uiValidationError} from '../errors.js';
import {
  getComponentReferences,
  MAX_GLOBAL_DEPTH,
  ValidationConfig,
} from '../validation/integrity-checker.js';
import {ComponentGraphBound, ComponentsWatcher} from './component-graph-bound.js';
import {ComponentModel} from './component-model.js';
import {SurfaceComponentsModel} from './surface-components-model.js';
import {SurfaceModel} from './surface-model.js';

/**
 * Resolves the catalog a raw component definition belongs to on `surface`.
 */
export type ResolveComponentCatalog<T extends ComponentApi = ComponentApi> = (
  comp: Record<string, unknown>,
  surface: SurfaceModel<T>,
) => Catalog<T>;

/**
 * Recorded `ComponentGraphBound` and change count for a `SurfaceComponentsModel`.
 */
export interface RecordedGraphBound {
  bound: ComponentGraphBound;
  changes: number;
}

/**
 * A batch of components as `validateCandidateTopology` reads it: each
 * component's child references, type and catalog, keyed by id.
 */
interface BatchGraph<T extends ComponentApi> {
  children: Map<string, string[]>;
  types: Map<string, string>;
  catalogs: Map<string, Catalog<T>>;
}

/** Whether each catalog declares `allowedParents` or `allowedChildren`. */
const catalogRules = new WeakMap<Catalog<ComponentApi>, boolean>();

/**
 * Checks the composition constraints and, under a `validationConfig`, the
 * topology of the surface a batch of components would leave behind,
 * changing nothing.
 *
 * Under a config that allows dangling references and does not check
 * reachability (it allows orphans or a missing root), as an agent's
 * renderer state configures it, the batch is checked against the
 * components it changes when the last check of the surface left a
 * `ComponentGraphBound` that still holds: cycles and depth through the
 * bound, and composition constraints on the components whose parents,
 * children or types the batch changes. When that cannot show the batch
 * passes, the whole surface is checked, so a batch that fails reports the
 * same error as before. Under any other config every check walks the whole
 * surface.
 *
 * @param surface Surface the batch updates.
 * @param newComponents Components of the batch.
 * @param validationConfig Active validation configuration, if any.
 * @param resolveCatalog Callback resolving each component's catalog on the surface.
 * @param graphBounds Map holding the last recorded bound per surface components model.
 * @returns The bound of the surface with the batch applied, to record once
 *     it is applied, or undefined when there is none to record.
 */
export function validateComponentGraph<T extends ComponentApi>(
  surface: SurfaceModel<T>,
  newComponents: Array<Record<string, unknown>>,
  validationConfig: ValidationConfig | undefined,
  resolveCatalog: ResolveComponentCatalog<T>,
  graphBounds: WeakMap<SurfaceComponentsModel, RecordedGraphBound>,
): ComponentGraphBound | undefined {
  const model = surface.componentsModel;
  const recorded = graphBounds.get(model);
  // A bound changes with the batch, and holds again only once it is applied.
  graphBounds.delete(model);

  if (!validationConfig || !defersGraphChecks(validationConfig)) {
    validateCompositionConstraints(surface, newComponents, resolveCatalog, validationConfig);
    validateCandidateTopology(surface, newComponents, resolveCatalog, validationConfig);
    return undefined;
  }

  const batch = batchGraph(surface, newComponents, resolveCatalog);
  const rootId = validationConfig.rootId ?? surface.rootId;
  if (
    batch &&
    recorded &&
    recorded.changes === ComponentsWatcher.of(model).changes &&
    (validationConfig.allowMissingRoot || batch.children.has(rootId) || model.has(rootId))
  ) {
    const {bound} = recorded;
    const previousChildren = new Map<string, readonly string[]>();
    for (const id of batch.children.keys()) {
      previousChildren.set(id, bound.childrenOf(id));
    }
    const admitted = bound.admits(
      batch.children,
      validationConfig.maxDepth ?? MAX_GLOBAL_DEPTH,
      id => model.has(id),
    );
    if (!compositionHolds(surface, batch, previousChildren, bound, validationConfig)) {
      // Reports the first violation in the order of the whole-surface check.
      validateCompositionConstraints(surface, newComponents, resolveCatalog, validationConfig);
    }
    if (admitted) return bound;
    const candidateGraph = validateCandidateTopology(
      surface,
      newComponents,
      resolveCatalog,
      validationConfig,
      true,
    );
    return candidateGraph ? ComponentGraphBound.of(candidateGraph) : undefined;
  }

  validateCompositionConstraints(surface, newComponents, resolveCatalog, validationConfig);
  const candidateGraph = validateCandidateTopology(
    surface,
    newComponents,
    resolveCatalog,
    validationConfig,
    true,
  );
  return candidateGraph ? ComponentGraphBound.of(candidateGraph) : undefined;
}

/**
 * Records the `ComponentGraphBound` of a surface after its component batch has
 * been applied to `model`.
 */
export function recordComponentGraphBound(
  model: SurfaceComponentsModel,
  bound: ComponentGraphBound,
  graphBounds: WeakMap<SurfaceComponentsModel, RecordedGraphBound>,
): void {
  graphBounds.set(model, {bound, changes: ComponentsWatcher.of(model).changes});
}

/**
 * Whether `validationConfig` allows dangling references and does not
 * check reachability, because it allows orphans or a missing root.
 */
export function defersGraphChecks(validationConfig: ValidationConfig | undefined): boolean {
  return (
    validationConfig !== undefined &&
    validationConfig.allowDanglingReferences === true &&
    (validationConfig.allowOrphanComponents === true || validationConfig.allowMissingRoot === true)
  );
}

/**
 * Reads a batch of components as `validateCandidateTopology` reads it into
 * its candidate model: each component's type, catalog and child references.
 *
 * @returns The batch, or undefined when a component in it has no type or a
 *     catalog that declares no components, whose references the topology
 *     and composition checks read differently; such a batch is checked
 *     against the whole surface.
 */
function batchGraph<T extends ComponentApi>(
  surface: SurfaceModel<T>,
  newComponents: Array<Record<string, unknown>>,
  resolveCatalog: ResolveComponentCatalog<T>,
): BatchGraph<T> | undefined {
  const batch: BatchGraph<T> = {children: new Map(), types: new Map(), catalogs: new Map()};
  for (const comp of newComponents) {
    const {id, component, ...properties} = comp;
    if (typeof id !== 'string' || !id) continue;
    const catalog = resolveCatalog(comp, surface);
    delete properties.catalogId;
    delete properties.metadata;
    const type =
      (typeof component === 'string' ? component : surface.componentsModel.get(id)?.type) || '';
    if (!type || catalog.components.size === 0) return undefined;
    const children = Array.from(
      getComponentReferences({...properties, id, component: type}, catalog.componentRefMap),
      ([childId]) => childId,
    );
    batch.children.set(id, children);
    batch.types.set(id, type);
    batch.catalogs.set(id, catalog);
  }
  return batch;
}

/**
 * Whether the composition constraints hold on the components a batch
 * affects, which are the only ones whose parents, children or types it
 * changes. The rest passed the check of an earlier batch and are unchanged.
 *
 * A component of the batch is checked against its parents and all of its
 * children. A child it references before or after it, outside the batch, may
 * have another parent, so only its parents are checked. A component outside
 * the batch that references a component of the batch keeps its parents and
 * children, but that child may now be of another type, so only the children
 * of the batch it references are checked. A container that holds many
 * children, receiving one per message, is then checked against one child
 * per message rather than all of them.
 */
function compositionHolds<T extends ComponentApi>(
  surface: SurfaceModel<T>,
  batch: BatchGraph<T>,
  previousChildren: ReadonlyMap<string, readonly string[]>,
  bound: ComponentGraphBound,
  validationConfig: ValidationConfig | undefined,
): boolean {
  if (!hasCompositionRules(surface, batch.catalogs.values(), validationConfig)) return true;
  const model = surface.componentsModel;
  const typeMap = {
    get: (id: string) => batch.types.get(id) ?? model.get(id)?.type,
  };
  // Children outside the batch whose parents may have changed.
  const moved = new Set<string>();
  // Components outside the batch that reference components of the batch,
  // with the components of the batch they reference.
  const holding = new Map<string, string[]>();
  for (const [id, children] of batch.children) {
    for (const child of children) {
      if (!batch.children.has(child)) moved.add(child);
    }
    for (const child of previousChildren.get(id) ?? []) {
      if (!batch.children.has(child)) moved.add(child);
    }
    for (const parent of bound.parentsOf(id)) {
      if (batch.children.has(parent)) continue;
      const held = holding.get(parent);
      if (held) {
        held.push(id);
      } else {
        holding.set(parent, [id]);
      }
    }
  }

  const componentApiOf = (id: string): {componentType: string; componentApi: T} | undefined => {
    const componentType = typeMap.get(id);
    if (!componentType) return undefined;
    const catalog = batch.catalogs.get(id) ?? (model.get(id)?.catalog as Catalog<T> | undefined);
    const componentApi = catalog?.components.get(componentType);
    return componentApi ? {componentType, componentApi} : undefined;
  };
  const checkParents = (id: string) => {
    const entry = componentApiOf(id);
    if (!entry) return;
    const {componentType, componentApi} = entry;
    if (componentApi.allowedParents && componentApi.allowedParents.length > 0) {
      const parents = Array.from(bound.parentsOf(id), parentId => ({
        parentId,
        parentType: typeMap.get(parentId) || 'Unknown',
      }));
      validateParentConstraints(
        id,
        componentType,
        componentApi.allowedParents,
        parents,
        validationConfig,
      );
    }
  };
  const checkChildren = (id: string, children: readonly string[]) => {
    const entry = componentApiOf(id);
    if (!entry) return;
    const {componentType, componentApi} = entry;
    if (componentApi.allowedChildren && componentApi.allowedChildren.length > 0) {
      validateChildConstraints(id, componentType, componentApi.allowedChildren, children, typeMap);
    }
  };

  try {
    for (const id of batch.children.keys()) {
      checkParents(id);
      checkChildren(id, bound.childrenOf(id));
    }
    for (const id of moved) checkParents(id);
    for (const [id, held] of holding) checkChildren(id, held);
  } catch {
    return false;
  }
  return true;
}

/**
 * Whether any catalog a surface's components may come from declares
 * `allowedParents` or `allowedChildren`. When none does, the composition
 * check has nothing to check.
 */
function hasCompositionRules<T extends ComponentApi>(
  surface: SurfaceModel<T>,
  batchCatalogs: Iterable<Catalog<ComponentApi>>,
  validationConfig: ValidationConfig | undefined,
): boolean {
  const declaresRules = (catalog: Catalog<ComponentApi>) => {
    let rules = catalogRules.get(catalog);
    if (rules === undefined) {
      rules = Array.from(catalog.components.values()).some(
        api =>
          (api.allowedParents !== undefined && api.allowedParents.length > 0) ||
          (api.allowedChildren !== undefined && api.allowedChildren.length > 0),
      );
      catalogRules.set(catalog, rules);
    }
    return rules;
  };
  for (const catalog of batchCatalogs) {
    if (declaresRules(catalog)) return true;
  }
  if (defersGraphChecks(validationConfig)) {
    // An agent's processor follows the components it checks incrementally.
    for (const catalog of ComponentsWatcher.of(surface.componentsModel).catalogs) {
      if (declaresRules(catalog)) return true;
    }
    return false;
  }
  // A renderer's processor adds no listeners of its own to the surface's
  // components. Components added through the processor resolve their
  // catalogs on the surface, so only one added from outside it can come
  // from another catalog.
  const surfaceCatalogs = new Set<Catalog<ComponentApi>>(surface.availableCatalogs.values());
  if (surface.defaultCatalog) surfaceCatalogs.add(surface.defaultCatalog);
  for (const catalog of surfaceCatalogs) {
    if (declaresRules(catalog)) return true;
  }
  for (const component of surface.componentsModel.values) {
    if (!surfaceCatalogs.has(component.catalog) && declaresRules(component.catalog)) {
      return true;
    }
  }
  return false;
}

function validateParentConstraints(
  id: string,
  componentType: string,
  allowedParents: string[],
  parents: Array<{parentId: string; parentType: string}> | undefined,
  validationConfig: ValidationConfig | undefined,
): void {
  if (!parents || parents.length === 0) {
    const isRoot = id === 'root';
    const enforceTopLevel =
      isRoot ||
      (validationConfig !== undefined && validationConfig.allowOrphanComponents === false);
    if (enforceTopLevel && !allowedParents.includes('Surface')) {
      throw new A2uiValidationError(
        `Component '${id}' (${componentType}) cannot be placed under parent 'Surface' (Surface). Allowed parents: ${JSON.stringify(allowedParents)}.`,
        undefined,
        'UNALLOWED_PARENT',
      );
    }
    return;
  }

  for (const parentInfo of parents) {
    if (!allowedParents.includes(parentInfo.parentType)) {
      throw new A2uiValidationError(
        `Component '${id}' (${componentType}) cannot be placed under parent '${parentInfo.parentId}' (${parentInfo.parentType || 'unknown'}). Allowed parents: ${JSON.stringify(allowedParents)}.`,
        undefined,
        'UNALLOWED_PARENT',
      );
    }
  }
}

function validateChildConstraints(
  id: string,
  componentType: string,
  allowedChildren: string[],
  children: readonly string[],
  typeMap: {get(id: string): string | undefined},
): void {
  for (const childId of children) {
    const childType = typeMap.get(childId);
    if (childType && !allowedChildren.includes(childType)) {
      throw new A2uiValidationError(
        `Container '${id}' (${componentType}) cannot contain child '${childId}' (${childType}). Allowed children: ${JSON.stringify(allowedChildren)}.`,
        undefined,
        'UNALLOWED_CHILD',
      );
    }
  }
}

function buildCompositionTopology<T extends ComponentApi>(
  surface: SurfaceModel<T>,
  newComponents: Array<Record<string, unknown>>,
  resolveCatalog: ResolveComponentCatalog<T>,
) {
  const typeMap = new Map<string, string>();
  const compCatalogMap = new Map<string, Catalog<T>>();
  const childMap = new Map<string, string[]>();

  for (const [id, model] of surface.componentsModel.entries) {
    typeMap.set(id, model.type);
    compCatalogMap.set(id, model.catalog as Catalog<T>);
    const children = surface.componentsModel.getChildIds(id);
    if (children.length > 0) {
      childMap.set(id, children);
    }
  }

  for (const comp of newComponents) {
    const {id, component, ...props} = comp;
    if (typeof id !== 'string') continue;

    const compCatalog = resolveCatalog(comp, surface);
    compCatalogMap.set(id, compCatalog);
    const existing = surface.componentsModel.get(id);
    const compType = (typeof component === 'string' ? component : existing?.type) ?? '';
    if (compType) {
      typeMap.set(id, compType);
    }
    const compDef = {id, component: compType, ...props};
    const children = Array.from(
      getComponentReferences(compDef, compCatalog as Catalog<ComponentApi>),
    ).map(([childId]) => childId);
    if (children.length > 0) {
      childMap.set(id, children);
    } else {
      childMap.delete(id);
    }
  }

  const parentMap = new Map<string, Array<{parentId: string; parentType: string}>>();
  for (const [parentId, children] of childMap.entries()) {
    const parentType = typeMap.get(parentId) || 'Unknown';
    for (const childId of children) {
      const parents = parentMap.get(childId) ?? [];
      parents.push({parentId, parentType});
      parentMap.set(childId, parents);
    }
  }

  return {typeMap, compCatalogMap, childMap, parentMap};
}

/**
 * Validates `allowedParents` and `allowedChildren` composition constraints
 * across the surface with `newComponents` applied.
 */
export function validateCompositionConstraints<T extends ComponentApi>(
  surface: SurfaceModel<T>,
  newComponents: Array<Record<string, unknown>>,
  resolveCatalog: ResolveComponentCatalog<T>,
  validationConfig: ValidationConfig | undefined,
): void {
  // The components of the batch have resolved their catalogs already, in
  // `validateComponentProperties`.
  const batchCatalogs = newComponents
    .filter(comp => typeof comp.id === 'string')
    .map(comp => resolveCatalog(comp, surface));
  if (!hasCompositionRules(surface, batchCatalogs, validationConfig)) return;

  const {typeMap, compCatalogMap, childMap, parentMap} = buildCompositionTopology(
    surface,
    newComponents,
    resolveCatalog,
  );

  for (const [id, componentType] of typeMap.entries()) {
    const compCatalog = compCatalogMap.get(id);
    const componentApi = compCatalog?.components.get(componentType);
    if (!componentApi) continue;

    if (componentApi.allowedParents && componentApi.allowedParents.length > 0) {
      validateParentConstraints(
        id,
        componentType,
        componentApi.allowedParents,
        parentMap.get(id),
        validationConfig,
      );
    }

    if (componentApi.allowedChildren && componentApi.allowedChildren.length > 0) {
      validateChildConstraints(
        id,
        componentType,
        componentApi.allowedChildren,
        childMap.get(id) || [],
        typeMap,
      );
    }
  }
}

/**
 * Checks the topology of the surface a batch would leave behind against
 * `validationConfig`, walking the whole surface.
 *
 * @param surface Surface the batch updates.
 * @param newComponents Components of the batch.
 * @param resolveCatalog Callback resolving each component's catalog on the surface.
 * @param validationConfig Active validation configuration, if any.
 * @param collectGraph Whether to return the references of that surface.
 * @returns When `collectGraph` is set, each component of that surface with
 *     the ids it references; otherwise, or without a config, undefined.
 */
export function validateCandidateTopology<T extends ComponentApi>(
  surface: SurfaceModel<T>,
  newComponents: Array<Record<string, unknown>>,
  resolveCatalog: ResolveComponentCatalog<T>,
  validationConfig: ValidationConfig | undefined,
  collectGraph = false,
): Map<string, string[]> | undefined {
  if (!validationConfig) return undefined;

  const candidateModel = new SurfaceComponentsModel(surface.defaultCatalog);
  for (const [id, comp] of surface.componentsModel.entries) {
    candidateModel.addComponent(
      new ComponentModel(id, comp.type, comp.properties, comp.catalog as Catalog<T>),
    );
  }

  for (const comp of newComponents) {
    const {id, component, ...properties} = comp;
    if (typeof id !== 'string' || !id) continue;

    const targetCatalog = resolveCatalog(comp, surface);
    delete properties.catalogId;
    delete properties.metadata;

    const existing = candidateModel.get(id);
    const componentType = (typeof component === 'string' ? component : existing?.type) || '';
    if (!componentType) continue;

    if (existing) {
      if (componentType !== existing.type || existing.catalog.id !== targetCatalog.id) {
        candidateModel.removeComponent(id);
        candidateModel.addComponent(
          new ComponentModel(id, componentType, properties, targetCatalog),
        );
      } else {
        existing.properties = properties;
      }
    } else {
      candidateModel.addComponent(new ComponentModel(id, componentType, properties, targetCatalog));
    }
  }

  candidateModel.validateTopology({
    ...validationConfig,
    rootId: validationConfig.rootId ?? surface.rootId,
  });
  if (!collectGraph) return undefined;

  const graph = new Map<string, string[]>();
  for (const id of candidateModel.keys) {
    graph.set(id, candidateModel.getChildIds(id));
  }
  return graph;
}
