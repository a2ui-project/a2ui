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

import {SurfaceModel} from '../state/surface-model.js';
import {ComponentModel} from '../state/component-model.js';
import {Catalog, ComponentApi, FunctionImplementation} from '../catalog/types.js';
import {ComponentContext} from '../rendering/component-context.js';
import {DataContext} from '../rendering/data-context.js';
import {BehaviorNode, GenericBinder, scrapeSchemaBehavior} from '../rendering/generic-binder.js';
import {
  ComponentNode,
  isComponentNode,
  MutableComponentNode,
  NodeProps,
  PLACEHOLDER_TYPE,
} from './component-node.js';
import {extractRefFields, RefFields} from './ref-fields.js';
import {ResolvedBinding, WritableBinding, sameBinding} from './resolved-binding.js';
import {Signal, signal, setValue, peekValue} from '../reactivity/signals.js';
import {Subscription} from '../common/events.js';
import {A2uiStateError} from '../errors.js';

const ROOT_COMPONENT_ID = 'root';
const ROOT_DATA_PATH = '/';
const ROOT_EDGE_KEY = '>root>root@/';

const EMPTY_REF_FIELDS: RefFields = new Map();

interface NodeRecord {
  readonly node: MutableComponentNode;
  readonly edgeKey: string;
  /** The node's ordinal among same-(componentId, dataPath) siblings, baked
   *  into its instanceId; reuse requires it to still match. */
  readonly occurrence: number;
  /** The node whose props reference this one; undefined for the root. */
  readonly parent?: MutableComponentNode;
  readonly refFields: RefFields;
  /** The scraped behavior tree for the component's schema; positions it
   *  classifies as DYNAMIC resolve to {@link ResolvedBinding}s in node
   *  props. Absent on placeholders. */
  readonly behavior?: BehaviorNode;
  /** Writes constructed for path-bound values go through this context's
   *  scoped data context. */
  readonly context?: ComponentContext;
  readonly componentModel?: ComponentModel;
  readonly binder?: GenericBinder<NodeProps>;
  binderSub?: {unsubscribe(): void};
  /** The most recent per-component resolution from the binder. */
  lastBinderProps?: NodeProps;
  /** Children this node currently references, keyed by edge. This parent owns their disposal. */
  childEdges: Map<string, MutableComponentNode>;
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
  readonly rootNode: Signal<ComponentNode<C> | undefined>;

  private readonly surface: SurfaceModel<C, F>;
  private readonly catalog: Catalog<C, F>;
  private readonly records = new Map<MutableComponentNode, NodeRecord>();
  private readonly nodesByEdge = new Map<string, MutableComponentNode>();
  private readonly nodesByComponentId = new Map<string, Set<MutableComponentNode>>();
  /** Parents holding a placeholder for a component id, awaiting its arrival. */
  private readonly pendingParents = new Map<string, Set<MutableComponentNode>>();
  /** Errors already dispatched, keyed by component id, then data path. */
  private readonly dispatchedErrors = new Map<string, Map<string, Set<string>>>();
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
    this.rootNode = signal<ComponentNode<C> | undefined>(undefined);

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

  /**
   * Dispatches once per (code, component, path) for as long as the condition
   * persists: the record is cleared when the component is deleted, when a
   * node for the pair resolves, or when a cyclic stand-in's edge goes away,
   * so a condition that is fixed and later reintroduced reports again.
   */
  private dispatchOnce(code: string, componentId: string, dataPath: string, message: string): void {
    let byPath = this.dispatchedErrors.get(componentId);
    if (!byPath) {
      byPath = new Map();
      this.dispatchedErrors.set(componentId, byPath);
    }
    let codes = byPath.get(dataPath);
    if (!codes) {
      codes = new Set();
      byPath.set(dataPath, codes);
    }
    if (codes.has(code)) {
      return;
    }
    codes.add(code);
    this.surface.dispatchError({code, message});
  }

  private clearDispatched(componentId: string, dataPath: string): void {
    const byPath = this.dispatchedErrors.get(componentId);
    if (byPath?.delete(dataPath) && byPath.size === 0) {
      this.dispatchedErrors.delete(componentId);
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
    this.dispatchedErrors.clear();
    this.rootRecord = undefined;
    setValue(this.rootNode, undefined);
  }

  /** No-op while a root record exists; root deletion clears it so a re-sent root rebuilds. */
  private buildRoot(): void {
    if (this.rootRecord) {
      return;
    }
    const node = this.createNode(ROOT_COMPONENT_ID, ROOT_DATA_PATH, ROOT_EDGE_KEY, undefined);
    this.rootRecord = this.records.get(node);
    // Sound: every impl a node carries came from this resolver's Catalog<C>.
    setValue(this.rootNode, node as ComponentNode<C>);
  }

  private onComponentCreated(component: ComponentModel): void {
    if (this._disposed) {
      return;
    }
    if (component.id === ROOT_COMPONENT_ID) {
      // Events deliver late; reconcile against the model's current root, not
      // the event payload. A stale creation must not rebuild a tree already
      // bound to the current model, nor create one the model no longer has.
      const current = this.surface.componentsModel.get(ROOT_COMPONENT_ID);
      if (this.rootRecord && this.rootRecord.componentModel !== current) {
        this.disposeNode(this.rootRecord.node);
        this.rootRecord = undefined;
        if (!current) {
          setValue(this.rootNode, undefined);
        }
      }
      if (current) {
        this.buildRoot();
      }
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
    // Model events deliver asynchronously, so a removal can arrive after the
    // component is already back; reconcile against current model state.
    this.dispatchedErrors.delete(id);
    const model = this.surface.componentsModel.get(id);
    const affected = this.nodesByComponentId.get(id);
    if (!affected) {
      return;
    }
    const parentsToRefresh = new Set<MutableComponentNode>();
    let rootAffected = false;
    for (const node of [...affected]) {
      const record = this.records.get(node);
      if (!record) {
        continue;
      }
      if (record.parent) {
        parentsToRefresh.add(record.parent);
      } else {
        rootAffected = true;
      }
    }
    if (rootAffected && this.rootRecord) {
      if (!model) {
        this.disposeNode(this.rootRecord.node);
        this.rootRecord = undefined;
        setValue(this.rootNode, undefined);
      } else if (this.rootRecord.componentModel !== model) {
        this.disposeNode(this.rootRecord.node);
        this.rootRecord = undefined;
        this.buildRoot();
      }
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
    parent: MutableComponentNode | undefined,
    occurrence = 1,
  ): MutableComponentNode {
    const model = this.surface.componentsModel.get(componentId);
    if (!model) {
      const record = this.registerNode(
        new MutableComponentNode(
          instanceIdFor(componentId, dataPath, occurrence),
          componentId,
          PLACEHOLDER_TYPE,
          dataPath,
          {},
          undefined,
          'pending',
        ),
        {edgeKey, parent, occurrence, refFields: EMPTY_REF_FIELDS},
      );
      if (parent) {
        this.registerPendingParent(componentId, parent);
      }
      return record.node;
    }

    const api = this.catalog.components.get(model.type);
    if (!api) {
      this.dispatchOnce(
        'UNKNOWN_COMPONENT_TYPE',
        componentId,
        dataPath,
        `Component '${componentId}' has type '${model.type}', which is not in catalog '${this.catalog.id}'.`,
      );
      return this.registerNode(
        new MutableComponentNode(
          instanceIdFor(componentId, dataPath, occurrence),
          componentId,
          model.type,
          dataPath,
          {},
          undefined,
          'unknown-type',
        ),
        {edgeKey, parent, occurrence, refFields: EMPTY_REF_FIELDS, componentModel: model},
      ).node;
    }

    this.clearDispatched(componentId, dataPath);
    const context = new ComponentContext(this.surface, componentId, dataPath);
    const binder = new GenericBinder<NodeProps>(context, api.schema);
    const record = this.registerNode(
      new MutableComponentNode(
        instanceIdFor(componentId, dataPath, occurrence),
        componentId,
        model.type,
        dataPath,
        {},
        api,
      ),
      {
        edgeKey,
        parent,
        occurrence,
        refFields: extractRefFields(api.schema),
        behavior: scrapeSchemaBehavior(api.schema),
        context,
        componentModel: model,
        binder,
      },
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
    node: MutableComponentNode,
    partial: {
      edgeKey: string;
      parent?: MutableComponentNode;
      occurrence: number;
      refFields: RefFields;
      behavior?: BehaviorNode;
      context?: ComponentContext;
      componentModel?: ComponentModel;
      binder?: GenericBinder<NodeProps>;
    },
  ): NodeRecord {
    const record: NodeRecord = {
      node,
      edgeKey: partial.edgeKey,
      parent: partial.parent,
      occurrence: partial.occurrence,
      refFields: partial.refFields,
      behavior: partial.behavior,
      context: partial.context,
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
    parent: MutableComponentNode,
    occurrence = 1,
  ): MutableComponentNode {
    const existing = this.nodesByEdge.get(edgeKey);
    if (this.isCyclic(componentId, dataPath, parent)) {
      // Node identity is parent-scoped, so a cyclic payload would otherwise
      // recurse forever; render the repeated reference as a placeholder.
      if (
        existing &&
        !existing.disposed &&
        existing.isPlaceholder &&
        this.records.get(existing)?.occurrence === occurrence
      ) {
        return existing;
      }
      if (existing && !existing.disposed) {
        this.disposeNode(existing);
      }
      this.dispatchOnce(
        'CYCLIC_REFERENCE',
        componentId,
        dataPath,
        `Component '${componentId}' at '${dataPath}' is referenced by one of its own descendants; rendering a placeholder instead.`,
      );
      return this.registerNode(
        new MutableComponentNode(
          instanceIdFor(componentId, dataPath, occurrence),
          componentId,
          PLACEHOLDER_TYPE,
          dataPath,
          {},
          undefined,
          'cyclic',
        ),
        {edgeKey, parent, occurrence, refFields: EMPTY_REF_FIELDS},
      ).node;
    }
    if (existing && !existing.disposed) {
      const model = this.surface.componentsModel.get(componentId);
      const api = model ? this.catalog.components.get(model.type) : undefined;
      // A placeholder stays up to date only while its own state's
      // preconditions hold, so a pending node whose definition arrives with
      // an unknown type is replaced (once) by an unknown-type node, and
      // either kind resolves when the type gains a catalog entry. Resolved
      // and unknown-type nodes must also still be bound to the current model
      // instance. A node whose sibling ordinal changed is rebuilt so
      // instance ids stay distinct after list edits.
      const existingRecord = this.records.get(existing);
      const upToDate =
        existing.componentId === componentId &&
        existing.dataPath === dataPath &&
        existingRecord?.occurrence === occurrence &&
        (existing.isPlaceholder
          ? (model === undefined && existing.state === 'pending') ||
            (model !== undefined &&
              api === undefined &&
              existing.state === 'unknown-type' &&
              existingRecord?.componentModel === model)
          : model !== undefined &&
            existing.type === model.type &&
            existingRecord?.componentModel === model);
      if (upToDate) {
        if (existing.state === 'pending') {
          // A deletion delivered between this component's add and remove
          // clears the waiting registration; reusing the placeholder without
          // restoring it would leave a later legitimate add unnoticed.
          this.registerPendingParent(componentId, parent);
        }
        return existing;
      }
      this.disposeNode(existing);
    }
    return this.createNode(componentId, dataPath, edgeKey, parent, occurrence);
  }

  /** Registers a parent to be refreshed when `componentId` arrives. */
  private registerPendingParent(componentId: string, parent: MutableComponentNode): void {
    let waiting = this.pendingParents.get(componentId);
    if (!waiting) {
      waiting = new Set();
      this.pendingParents.set(componentId, waiting);
    }
    waiting.add(parent);
  }

  /** True when (componentId, dataPath) already appears in the parent chain. */
  private isCyclic(componentId: string, dataPath: string, parent: MutableComponentNode): boolean {
    for (
      let node: MutableComponentNode | undefined = parent;
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
   * the shallow comparison in `MutableComponentNode.setProps` stays exact.
   */
  private materialize(record: NodeRecord): void {
    if (record.node.disposed) {
      return;
    }
    const raw = record.lastBinderProps ?? record.binder?.snapshot ?? {};
    const next: NodeProps = {...raw};
    const newEdges = new Map<string, MutableComponentNode>();

    // The binder merges rebuilt props over previous ones and never drops a
    // key the component's properties no longer contain. Ref props drive child
    // lifecycles, so their presence must follow the component model exactly.
    const modelProps = record.componentModel?.properties;
    if (modelProps) {
      for (const key of record.refFields.keys()) {
        if (key in next && !(key in modelProps)) {
          delete next[key];
        }
      }
    }

    // Ordinal per (componentId, dataPath) within this rebuild, so repeated
    // references to one component get distinct instance ids.
    const occurrences = new Map<string, number>();
    const resolveChild = (slot: string, componentId: string, dataPath: string): ComponentNode => {
      const occurrenceKey = `${escapeIdPart(componentId)}@${escapeIdPart(dataPath)}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      const edgeKey = `${record.edgeKey}>${slot}>${occurrenceKey}`;
      const child = this.childNode(componentId, dataPath, edgeKey, record.node, occurrence);
      newEdges.set(edgeKey, child);
      return child;
    };

    for (const [key, ref] of record.refFields) {
      switch (ref.kind) {
        case 'single': {
          const value = next[key];
          if (typeof value === 'string' && value) {
            next[key] = resolveChild(escapeIdPart(key), value, record.node.dataPath);
          }
          break;
        }
        case 'list': {
          const value = next[key];
          if (!Array.isArray(value)) {
            break;
          }
          next[key] = value.map((item, index) => {
            if (typeof item === 'string' && item) {
              return resolveChild(`${escapeIdPart(key)}[${index}]`, item, record.node.dataPath);
            }
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const entry = item as Record<string, unknown>;
              // The binder resolves a {componentId, path} template into
              // {id, basePath} pairs, one per array element.
              if (typeof entry.id === 'string' && typeof entry.basePath === 'string') {
                return resolveChild(`${escapeIdPart(key)}[${index}]`, entry.id, entry.basePath);
              }
              if (typeof entry.componentId === 'string' && entry.componentId) {
                return resolveChild(
                  `${escapeIdPart(key)}[${index}]`,
                  entry.componentId,
                  record.node.dataPath,
                );
              }
            }
            return item;
          });
          break;
        }
        case 'nested': {
          const value = next[key];
          if (!Array.isArray(value)) {
            break;
          }
          next[key] = value.map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              return item;
            }
            const entry = {...(item as Record<string, unknown>)};
            let resolvedAny = false;
            for (const subKey of ref.keys) {
              const childId = entry[subKey];
              if (typeof childId === 'string' && childId) {
                entry[subKey] = resolveChild(
                  `${escapeIdPart(key)}[${index}].${escapeIdPart(subKey)}`,
                  childId,
                  record.node.dataPath,
                );
                resolvedAny = true;
              }
            }
            return resolvedAny ? entry : item;
          });
          break;
        }
      }
    }

    for (const [edgeKey, child] of record.childEdges) {
      if (!newEdges.has(edgeKey)) {
        this.disposeNode(child);
        if (child.isPlaceholder) {
          const stillWaiting = [...newEdges.values()].some(
            other => other.isPlaceholder && other.componentId === child.componentId,
          );
          if (!stillWaiting) {
            const waiting = this.pendingParents.get(child.componentId);
            if (waiting) {
              waiting.delete(record.node);
              if (waiting.size === 0) {
                this.pendingParents.delete(child.componentId);
              }
            }
          }
        }
      }
    }
    record.childEdges = newEdges;

    const wrapped =
      record.behavior && record.context
        ? (wrapDynamicValues(
            next,
            record.behavior,
            modelProps ?? {},
            record.context.dataContext,
          ) as NodeProps)
        : next;

    // peekValue avoids creating a reactive dependency inside materialize.
    const previous = peekValue(record.node.props);
    for (const key of Object.keys(wrapped)) {
      wrapped[key] = stabilize(previous[key], wrapped[key]);
    }
    record.node.setProps(wrapped);
  }

  /** Disposes a node and, through parent-scoped ownership, its subtree. */
  private disposeNode(node: MutableComponentNode): void {
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
    for (const [componentId, waiting] of this.pendingParents) {
      waiting.delete(node);
      if (waiting.size === 0) {
        this.pendingParents.delete(componentId);
      }
    }
    if (node.state === 'cyclic') {
      // The cyclic edge is gone; a payload that reintroduces it should report.
      this.clearDispatched(node.componentId, node.dataPath);
    }
    node.dispose();
  }
}

/**
 * Escapes the characters that carry meaning in composed instance ids and
 * edge keys (`~`, `#`, `[`, `]`, `>`, `@`), so a component id, data path, or
 * property name containing them cannot collide with the composed form of a
 * different tuple. Parts without these characters are unchanged.
 */
const ID_PART_ESCAPES: Record<string, string> = {
  '~': '~0',
  '#': '~1',
  '[': '~2',
  ']': '~3',
  '>': '~4',
  '@': '~5',
};

// A single pass, so no replacement can see the output of an earlier one.
function escapeIdPart(part: string): string {
  return part.replace(/[~#[\]>@]/g, match => ID_PART_ESCAPES[match]);
}

function instanceIdFor(componentId: string, dataPath: string, occurrence: number): string {
  const trimmed = dataPath.replace(/\/+$/, '') || ROOT_DATA_PATH;
  const base =
    dataPath === ROOT_DATA_PATH
      ? escapeIdPart(componentId)
      : `${escapeIdPart(componentId)}-[${escapeIdPart(trimmed)}]`;
  return occurrence > 1 ? `${base}#${occurrence}` : base;
}

/**
 * Converts every position the schema classifies as DYNAMIC into a
 * `ResolvedBinding`: the binder's resolved value as the snapshot, plus a
 * write capability iff the payload gave the value as a `{"path": ...}`
 * binding, writing through the component's scoped data context. The binder's
 * synthesized `set<Prop>` siblings are dropped: they silently swallow writes
 * to literal-valued properties, whereas a read-only `ResolvedBinding` has no `set`,
 * making such writes a type error.
 */
function wrapDynamicValues(
  value: unknown,
  behavior: BehaviorNode,
  raw: unknown,
  dataContext: DataContext,
): unknown {
  switch (behavior.type) {
    case 'DYNAMIC': {
      const path =
        raw &&
        typeof raw === 'object' &&
        !Array.isArray(raw) &&
        typeof (raw as {path?: unknown}).path === 'string'
          ? (raw as {path: string}).path
          : undefined;
      if (path === undefined) {
        return new ResolvedBinding(value);
      }
      return new WritableBinding(value, newValue => dataContext.set(path, newValue), path);
    }
    case 'ARRAY': {
      if (!Array.isArray(value)) {
        return value;
      }
      const rawItems = Array.isArray(raw) ? raw : [];
      return value.map((item, index) =>
        wrapDynamicValues(item, behavior.element, rawItems[index], dataContext),
      );
    }
    case 'OBJECT': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
      }
      const setterNames = new Set<string>();
      for (const [key, childBehavior] of Object.entries(behavior.shape)) {
        if (childBehavior.type === 'DYNAMIC') {
          setterNames.add(`set${key.charAt(0).toUpperCase()}${key.slice(1)}`);
        }
      }
      const rawRecord =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (setterNames.has(key)) {
          continue;
        }
        out[key] = wrapDynamicValues(
          item,
          behavior.shape[key] ?? {type: 'STATIC'},
          rawRecord[key],
          dataContext,
        );
      }
      // The binder guarantees every dynamic property a setter even when the
      // payload omits it. Represent an omitted one as a read-only binding of
      // undefined, at every nesting level, so consumers synthesizing setters
      // from bindings keep that guarantee.
      for (const [key, childBehavior] of Object.entries(behavior.shape)) {
        if (childBehavior.type === 'DYNAMIC' && !(key in out)) {
          out[key] = new ResolvedBinding(undefined);
        }
      }
      return out;
    }
    default:
      return value;
  }
}

/**
 * Returns `prev` whenever `next` is structurally identical to it, so
 * unchanged props keep reference identity across rebuilds. Child
 * `ComponentNode`s and action closures compare by identity, and
 * `ResolvedBinding`s by `sameBinding`.
 */
function stabilize(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) {
    return next;
  }
  if (prev instanceof ResolvedBinding && next instanceof ResolvedBinding) {
    return sameBinding(prev, next) ? prev : next;
  }
  if (isComponentNode(prev) || isComponentNode(next)) {
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
  if (!value || typeof value !== 'object' || Array.isArray(value) || isComponentNode(value)) {
    return false;
  }
  // Maps, Dates, and class instances have no own enumerable keys to compare,
  // so key-wise stabilization would wrongly report them unchanged; treat any
  // non-literal object as always-changed instead.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
