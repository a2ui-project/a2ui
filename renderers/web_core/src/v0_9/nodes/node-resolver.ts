/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {SurfaceModel} from '../state/surface-model.js';
import {ComponentModel} from '../state/component-model.js';
import {Catalog, ComponentApi, FunctionImplementation} from '../catalog/types.js';
import {ComponentContext} from '../rendering/component-context.js';
import {GenericBinder} from '../rendering/generic-binder.js';
import {ComponentNode, NodeProps, PLACEHOLDER_TYPE} from './component-node.js';
import {extractRefFields, RefFields} from './ref-fields.js';
import {Signal, signal, setValue, peekValue} from '../reactivity/signals.js';
import {Subscription} from '../common/events.js';
import {A2uiStateError} from '../errors.js';

const ROOT_COMPONENT_ID = 'root';
const ROOT_DATA_PATH = '/';
const ROOT_EDGE_KEY = '>root>root@/';

const EMPTY_REF_FIELDS: RefFields = {single: new Set(), list: new Set(), nested: new Map()};

interface NodeRecord {
  readonly node: ComponentNode;
  readonly edgeKey: string;
  /** The node whose props reference this one; undefined for the root. */
  readonly parent?: ComponentNode;
  readonly refFields: RefFields;
  readonly componentModel?: ComponentModel;
  readonly binder?: GenericBinder<NodeProps>;
  binderSub?: {unsubscribe(): void};
  /** The most recent per-component resolution from the binder. */
  lastBinderProps?: NodeProps;
  /** Children this node currently references, keyed by edge. This parent owns their disposal. */
  childEdges: Map<string, ComponentNode>;
}

/**
 * The tree engine of the node layer: turns a surface's flat component map
 * into a live tree of resolved {@link ComponentNode}s rooted at
 * {@link rootNode}. Child references become `ComponentNode` objects, template
 * `ChildList`s spawn one node per array item, not-yet-arrived components
 * appear as placeholder nodes and are upgraded in place, and every node's
 * binder and data subscriptions are torn down when its parent stops
 * referencing it or the resolver is disposed.
 *
 * Construction requires a catalog whose functions are executable
 * (`F extends FunctionImplementation`). A schema-only catalog
 * (`Catalog<C, FunctionApi>`) fails this bound at compile time: without
 * implementations, function-derived values cannot resolve and the tree this
 * class produces would be wrong. Hosts without implementations (agent-side
 * code) operate on `SurfaceModel` directly and never construct a resolver.
 *
 * Node identity is parent-scoped: each referencing position gets its own
 * node, so one component id mounted at two positions yields two nodes and
 * dropping one position never tears down the other.
 */
export class NodeResolver<
  C extends ComponentApi = ComponentApi,
  F extends FunctionImplementation = FunctionImplementation,
> {
  /** The resolved root of the tree; undefined until the root component arrives. */
  readonly rootNode: Signal<ComponentNode | undefined>;

  private readonly surface: SurfaceModel<C, F>;
  private readonly catalog: Catalog<C, F>;
  private readonly records = new Map<ComponentNode, NodeRecord>();
  private readonly nodesByEdge = new Map<string, ComponentNode>();
  private readonly nodesByComponentId = new Map<string, Set<ComponentNode>>();
  /** Parents holding a placeholder for a component id, awaiting its arrival. */
  private readonly pendingParents = new Map<string, Set<ComponentNode>>();
  private readonly modelSubs: Subscription[] = [];
  private rootRecord?: NodeRecord;
  private _disposed = false;

  constructor(surface: SurfaceModel<C, F>, catalog: Catalog<C, F>) {
    if ((catalog as unknown) !== (surface.catalog as unknown)) {
      throw new A2uiStateError(
        'NodeResolver requires the same catalog instance its surface was constructed with.',
      );
    }
    this.surface = surface;
    this.catalog = catalog;
    this.rootNode = signal<ComponentNode | undefined>(undefined);

    this.modelSubs.push(
      surface.componentsModel.onCreated.subscribe(component => this.onComponentCreated(component)),
    );
    this.modelSubs.push(
      surface.componentsModel.onDeleted.subscribe(id => this.onComponentDeleted(id)),
    );

    if (surface.componentsModel.get(ROOT_COMPONENT_ID)) {
      this.buildRoot();
    }
  }

  /** Number of live nodes (including placeholders). Exposed for tests and devtools. */
  get activeNodeCount(): number {
    return this.records.size;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  /** Tears down the whole tree and stops tracking the surface. Idempotent. */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    for (const sub of this.modelSubs) {
      sub.unsubscribe();
    }
    this.modelSubs.length = 0;
    for (const node of [...this.records.keys()]) {
      this.disposeNode(node);
    }
    this.pendingParents.clear();
    this.rootRecord = undefined;
    setValue(this.rootNode, undefined);
  }

  private buildRoot(): void {
    const node = this.createNode(ROOT_COMPONENT_ID, ROOT_DATA_PATH, ROOT_EDGE_KEY, undefined);
    this.rootRecord = this.records.get(node);
    setValue(this.rootNode, node);
  }

  private onComponentCreated(component: ComponentModel): void {
    if (this._disposed) {
      return;
    }
    if (component.id === ROOT_COMPONENT_ID && !this.rootRecord) {
      this.buildRoot();
    }
    const waiting = this.pendingParents.get(component.id);
    if (waiting) {
      this.pendingParents.delete(component.id);
      for (const parent of waiting) {
        const record = this.records.get(parent);
        if (record && !parent.disposed) {
          this.materialize(record);
        }
      }
    }
  }

  private onComponentDeleted(id: string): void {
    if (this._disposed) {
      return;
    }
    const affected = this.nodesByComponentId.get(id);
    if (!affected) {
      return;
    }
    const parentsToRefresh = new Set<ComponentNode>();
    let rootDeleted = false;
    for (const node of [...affected]) {
      const record = this.records.get(node);
      if (!record) {
        continue;
      }
      if (record.parent) {
        parentsToRefresh.add(record.parent);
      } else {
        rootDeleted = true;
      }
    }
    if (rootDeleted && this.rootRecord) {
      this.disposeNode(this.rootRecord.node);
      this.rootRecord = undefined;
      setValue(this.rootNode, undefined);
    }
    for (const parent of parentsToRefresh) {
      const record = this.records.get(parent);
      if (record && !parent.disposed) {
        this.materialize(record);
      }
    }
  }

  /**
   * Creates a node for one (componentId, dataPath) edge. A missing component
   * definition yields a placeholder node and registers the parent for a
   * refresh when the definition arrives.
   */
  private createNode(
    componentId: string,
    dataPath: string,
    edgeKey: string,
    parent: ComponentNode | undefined,
  ): ComponentNode {
    const model = this.surface.componentsModel.get(componentId);
    if (!model) {
      const record = this.registerNode(
        new ComponentNode(
          instanceIdFor(componentId, dataPath),
          componentId,
          PLACEHOLDER_TYPE,
          dataPath,
          {},
        ),
        {edgeKey, parent, refFields: EMPTY_REF_FIELDS},
      );
      if (parent) {
        let waiting = this.pendingParents.get(componentId);
        if (!waiting) {
          waiting = new Set();
          this.pendingParents.set(componentId, waiting);
        }
        waiting.add(parent);
      }
      return record.node;
    }

    const api = this.catalog.components.get(model.type);
    if (!api) {
      this.surface.dispatchError({
        code: 'UNKNOWN_COMPONENT_TYPE',
        message: `Component '${componentId}' has type '${model.type}', which is not in catalog '${this.catalog.id}'.`,
      });
      return this.registerNode(
        new ComponentNode(
          instanceIdFor(componentId, dataPath),
          componentId,
          PLACEHOLDER_TYPE,
          dataPath,
          {},
        ),
        {edgeKey, parent, refFields: EMPTY_REF_FIELDS},
      ).node;
    }

    const context = new ComponentContext(this.surface, componentId, dataPath);
    const binder = new GenericBinder<NodeProps>(context, api.schema);
    const record = this.registerNode(
      new ComponentNode(
        instanceIdFor(componentId, dataPath),
        componentId,
        model.type,
        dataPath,
        {},
      ),
      {edgeKey, parent, refFields: extractRefFields(api.schema), componentModel: model, binder},
    );
    record.binderSub = binder.subscribe(raw => {
      record.lastBinderProps = raw;
      this.materialize(record);
    });
    // The binder resolves synchronously while connecting, but notifies only
    // listeners registered before that resolution, so the first
    // materialization must be seeded from its snapshot.
    record.lastBinderProps = binder.snapshot;
    this.materialize(record);
    return record.node;
  }

  private registerNode(
    node: ComponentNode,
    partial: {
      edgeKey: string;
      parent?: ComponentNode;
      refFields: RefFields;
      componentModel?: ComponentModel;
      binder?: GenericBinder<NodeProps>;
    },
  ): NodeRecord {
    const record: NodeRecord = {
      node,
      edgeKey: partial.edgeKey,
      parent: partial.parent,
      refFields: partial.refFields,
      componentModel: partial.componentModel,
      binder: partial.binder,
      childEdges: new Map(),
    };
    this.records.set(node, record);
    this.nodesByEdge.set(partial.edgeKey, node);
    let byId = this.nodesByComponentId.get(node.componentId);
    if (!byId) {
      byId = new Set();
      this.nodesByComponentId.set(node.componentId, byId);
    }
    byId.add(node);
    return record;
  }

  /**
   * Returns the node for a child edge, reusing the cached node when the edge
   * is unchanged and replacing it (placeholder upgrade or downgrade, id
   * change, type change) when it is not.
   */
  private childNode(
    componentId: string,
    dataPath: string,
    edgeKey: string,
    parent: ComponentNode,
  ): ComponentNode {
    const existing = this.nodesByEdge.get(edgeKey);
    if (this.isCyclic(componentId, dataPath, parent)) {
      // Node identity is parent-scoped, so a cyclic payload would otherwise
      // recurse forever; render the repeated reference as a placeholder.
      if (existing && !existing.disposed && existing.isPlaceholder) {
        return existing;
      }
      if (existing && !existing.disposed) {
        this.disposeNode(existing);
      }
      this.surface.dispatchError({
        code: 'CYCLIC_REFERENCE',
        message: `Component '${componentId}' at '${dataPath}' is referenced by one of its own descendants; rendering a placeholder instead.`,
      });
      return this.registerNode(
        new ComponentNode(
          instanceIdFor(componentId, dataPath),
          componentId,
          PLACEHOLDER_TYPE,
          dataPath,
          {},
        ),
        {edgeKey, parent, refFields: EMPTY_REF_FIELDS},
      ).node;
    }
    if (existing && !existing.disposed) {
      const model = this.surface.componentsModel.get(componentId);
      const api = model ? this.catalog.components.get(model.type) : undefined;
      // A placeholder stays up to date while its component is missing, and
      // also while the component exists but has no catalog entry; recreating
      // it cannot improve either situation.
      const upToDate =
        existing.componentId === componentId &&
        existing.dataPath === dataPath &&
        (existing.isPlaceholder ? !model || !api : !!model && existing.type === model.type);
      if (upToDate) {
        return existing;
      }
      this.disposeNode(existing);
    }
    return this.createNode(componentId, dataPath, edgeKey, parent);
  }

  /** True when (componentId, dataPath) already appears in the parent chain. */
  private isCyclic(componentId: string, dataPath: string, parent: ComponentNode): boolean {
    for (
      let node: ComponentNode | undefined = parent;
      node;
      node = this.records.get(node)?.parent
    ) {
      if (node.componentId === componentId && node.dataPath === dataPath) {
        return true;
      }
    }
    return false;
  }

  /**
   * Rebuilds a node's resolved props from its binder output: child reference
   * properties become live `ComponentNode`s, children this parent no longer
   * references are disposed, and unchanged values keep reference identity so
   * the node's shallow emission gate stays exact.
   */
  private materialize(record: NodeRecord): void {
    if (record.node.disposed) {
      return;
    }
    const raw = record.lastBinderProps ?? record.binder?.snapshot ?? {};
    const next: NodeProps = {...raw};
    const newEdges = new Map<string, ComponentNode>();

    // The binder merges rebuilt props over previous ones and never drops a
    // key the component's properties no longer contain. Ref props drive child
    // lifecycles, so their presence must follow the component model exactly.
    const modelProps = record.componentModel?.properties;
    if (modelProps) {
      for (const refKeys of [record.refFields.single, record.refFields.list]) {
        for (const key of refKeys) {
          if (key in next && !(key in modelProps)) {
            delete next[key];
          }
        }
      }
      for (const key of record.refFields.nested.keys()) {
        if (key in next && !(key in modelProps)) {
          delete next[key];
        }
      }
    }

    const resolveChild = (slot: string, componentId: string, dataPath: string): ComponentNode => {
      const edgeKey = `${record.edgeKey}>${slot}>${componentId}@${dataPath}`;
      const child = this.childNode(componentId, dataPath, edgeKey, record.node);
      newEdges.set(edgeKey, child);
      return child;
    };

    for (const key of record.refFields.single) {
      const value = next[key];
      if (typeof value === 'string' && value) {
        next[key] = resolveChild(key, value, record.node.dataPath);
      }
    }

    for (const key of record.refFields.list) {
      const value = next[key];
      if (!Array.isArray(value)) {
        continue;
      }
      next[key] = value.map((item, index) => {
        if (typeof item === 'string' && item) {
          return resolveChild(`${key}[${index}]`, item, record.node.dataPath);
        }
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entry = item as Record<string, unknown>;
          // The binder resolves a {componentId, path} template into
          // {id, basePath} pairs, one per array element.
          if (typeof entry.id === 'string' && typeof entry.basePath === 'string') {
            return resolveChild(`${key}[${index}]`, entry.id, entry.basePath);
          }
          if (typeof entry.componentId === 'string' && entry.componentId) {
            return resolveChild(`${key}[${index}]`, entry.componentId, record.node.dataPath);
          }
        }
        return item;
      });
    }

    for (const [key, subKeys] of record.refFields.nested) {
      const value = next[key];
      if (!Array.isArray(value)) {
        continue;
      }
      next[key] = value.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return item;
        }
        const entry = {...(item as Record<string, unknown>)};
        let resolvedAny = false;
        for (const subKey of subKeys) {
          const childId = entry[subKey];
          if (typeof childId === 'string' && childId) {
            entry[subKey] = resolveChild(
              `${key}[${index}].${subKey}`,
              childId,
              record.node.dataPath,
            );
            resolvedAny = true;
          }
        }
        return resolvedAny ? entry : item;
      });
    }

    for (const [edgeKey, child] of record.childEdges) {
      if (!newEdges.has(edgeKey)) {
        this.disposeNode(child);
        if (child.isPlaceholder) {
          const stillWaiting = [...newEdges.values()].some(
            other => other.isPlaceholder && other.componentId === child.componentId,
          );
          if (!stillWaiting) {
            this.pendingParents.get(child.componentId)?.delete(record.node);
          }
        }
      }
    }
    record.childEdges = newEdges;

    // peekValue avoids creating a reactive dependency inside materialize.
    const previous = peekValue(record.node.props);
    for (const key of Object.keys(next)) {
      next[key] = stabilize(previous[key], next[key]);
    }
    record.node.setProps(next);
  }

  /** Disposes a node and, through parent-scoped ownership, its subtree. */
  private disposeNode(node: ComponentNode): void {
    if (node.disposed) {
      return;
    }
    const record = this.records.get(node);
    if (record) {
      for (const child of record.childEdges.values()) {
        this.disposeNode(child);
      }
      record.childEdges.clear();
      record.binderSub?.unsubscribe();
      record.binderSub = undefined;
      if (this.nodesByEdge.get(record.edgeKey) === node) {
        this.nodesByEdge.delete(record.edgeKey);
      }
      this.records.delete(node);
    }
    const byId = this.nodesByComponentId.get(node.componentId);
    if (byId) {
      byId.delete(node);
      if (byId.size === 0) {
        this.nodesByComponentId.delete(node.componentId);
      }
    }
    for (const waiting of this.pendingParents.values()) {
      waiting.delete(node);
    }
    node.dispose();
  }
}

function instanceIdFor(componentId: string, dataPath: string): string {
  if (dataPath === ROOT_DATA_PATH) {
    return componentId;
  }
  const trimmed = dataPath.replace(/\/+$/, '') || ROOT_DATA_PATH;
  return `${componentId}-[${trimmed}]`;
}

/**
 * Returns `prev` whenever `next` is structurally identical to it, so
 * unchanged props keep reference identity across rebuilds. Child
 * `ComponentNode`s and action closures compare by identity.
 */
function stabilize(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) {
    return next;
  }
  if (prev instanceof ComponentNode || next instanceof ComponentNode) {
    return next;
  }
  if (Array.isArray(prev) && Array.isArray(next) && prev.length === next.length) {
    let allSame = true;
    const out = next.map((item, i) => {
      const stabilized = stabilize(prev[i], item);
      if (!Object.is(stabilized, prev[i])) {
        allSame = false;
      }
      return stabilized;
    });
    return allSame ? prev : out;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    if (prevKeys.length === nextKeys.length) {
      let allSame = true;
      const out: Record<string, unknown> = {};
      for (const key of nextKeys) {
        const stabilized = stabilize(prev[key], next[key]);
        out[key] = stabilized;
        if (!(key in prev) || !Object.is(stabilized, prev[key])) {
          allSame = false;
        }
      }
      return allSame ? prev : out;
    }
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof ComponentNode
  ) {
    return false;
  }
  // Maps, Dates, and class instances have no own enumerable keys to compare,
  // so key-wise stabilization would wrongly report them unchanged; treat any
  // non-literal object as always-changed instead.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
