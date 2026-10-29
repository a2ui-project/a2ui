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

/**
 * The agent's mirror of the surfaces that a renderer holds.
 */

import {
  A2uiCatalogError,
  A2uiError,
  A2uiIntegrityError,
  A2uiValidationError,
  CatalogApi,
  ComponentApi,
  ComponentModel,
  MessageProcessor,
  STRICT_VALIDATION,
  SurfaceModel,
  ValidationConfig,
} from '../internal/web-core.js';
import {checkParserCatalogs} from './catalog-checks.js';
import {validateEnvelope} from './envelope-validation.js';
import {toReleaseLine} from './protocol-version.js';

/**
 * The `version` values that messages for each release line's catalogs state, spelled as
 * the specification spells them. As in the core's catalog compatibility, v0.9 and v0.9.1
 * catalogs are interchangeable, so both accept either version.
 */
const MESSAGE_VERSIONS: Readonly<Record<string, readonly string[]>> = {
  'v0.9': ['v0.9', 'v0.9.1'],
  '1.0': ['1.0'],
};

const CREATE_ACTIONS = ['createSurface'] as const;
const UPDATE_ACTIONS = ['updateComponents', 'updateDataModel', 'deleteSurface'] as const;

/**
 * Messages are applied one at a time, and a component may name a child that a later
 * message adds, so references, the root and reachability are left to
 * `RendererState.checkTopology`. Unlike `RELAXED_VALIDATION`, unknown components are still
 * rejected.
 */
const IN_PROGRESS_VALIDATION: ValidationConfig = Object.freeze({
  allowDanglingReferences: true,
  allowMissingRoot: true,
  allowOrphanComponents: true,
  allowUnknownElements: false,
});

type Message = Record<string, unknown>;

/** Undoes one change to the state. */
type Undo = () => void;

/** A non-negative array index, as a JSON Pointer segment spells it. */
const INDEX = /^(0|[1-9][0-9]*)$/;

/** The processor that `RendererState.of` hands to the constructor it calls. */
let sharedProcessor: MessageProcessor | undefined;

/**
 * The agent's mirror of the surfaces a renderer holds.
 *
 * The state wraps one web_core `MessageProcessor` and runs the agent's outbound messages
 * through it, so a message is checked against everything the renderer has already
 * received: a reference resolves against the components earlier messages added, and a
 * cycle is found across the whole surface.
 *
 * How long a state lives is the one difference between the two ways an agent shows UI:
 *
 * - In a chat, each turn shows new UI, so each turn uses a new state. A parser makes one
 *   when it is given none.
 * - In a canvas, turns update the same surfaces, so one state lives for the whole
 *   conversation and every turn is parsed against it.
 *
 * A message is applied when it is sent. `apply` is atomic: if a message is rejected, the
 * state is left as it was before the call. `transaction` extends that to several calls,
 * which is how a response parsed whole is applied all or nothing. A streamed response
 * cannot be rolled back, since the renderer has already received what was emitted.
 *
 * Being atomic costs what the messages change, not the size of the surfaces they touch.
 * While an `apply` or a transaction is open, the state keeps an undo log: each message
 * records what it replaced, and a failure reverts those records, latest first. A deleted
 * surface is the one change recorded whole, and it is restored straight into the model. No
 * surface is copied when a message is applied or a transaction opens. A rollback leaves the
 * state as it was, down to the order of each surface's components and of each data model
 * object's keys.
 *
 * The state holds the surfaces as they now stand, not the messages that built them.
 *
 * An update to a surface the state never saw created is rejected, as the renderer would
 * reject it.
 *
 * The state is authoritative for surfaces and their components. The data model values it
 * holds can drift from the renderer's, since the user edits bound inputs there, but no
 * check depends on them.
 *
 * An app that is both the agent and the renderer makes the state with `RendererState.of`,
 * on the processor it renders from, so each message is checked and applied once.
 */
export class RendererState {
  private readonly _catalogs: CatalogApi[];
  private readonly releaseLine: string;
  private readonly processor: MessageProcessor;
  private readonly assumed = new Set<string>();
  /** The components each surface added or replaced since its tree was last checked. */
  private readonly changed = new Map<string, Set<string>>();
  /** How to undo each change made since the outermost open `apply` or transaction began. */
  private readonly log: Undo[] = [];
  /** How many `apply` calls and transactions are open. */
  private open = 0;
  /** How many promises that transaction functions returned are still running. */
  private runaway = 0;
  /** The function calls applied since the outermost open `apply` or transaction began. */
  private readonly calls: Message[] = [];

  /**
   * Creates the empty state of a renderer that holds the catalogs.
   *
   * @param catalogs The active catalogs, which must target compatible protocol versions.
   *     Each surface is checked against the catalog its `catalogId` names.
   * @throws {A2uiCatalogError} If no catalogs are given, if two share an id, if their
   *     messages state different versions, for example v0.9 and v1.0 catalogs, or if they
   *     target a protocol version the state does not support, such as v0.8.
   */
  constructor(catalogs: CatalogApi[]) {
    if (!catalogs || catalogs.length === 0) {
      throw new A2uiCatalogError('A renderer state requires at least one catalog.');
    }
    const wireVersion = checkParserCatalogs(catalogs);
    this.releaseLine = toReleaseLine(wireVersion);
    if (!Object.prototype.hasOwnProperty.call(MESSAGE_VERSIONS, this.releaseLine)) {
      throw new A2uiCatalogError(
        `The catalogs target ${wireVersion}, which a renderer state does not support. It supports ${Object.values(
          MESSAGE_VERSIONS,
        )
          .flat()
          .join(', ')}.`,
      );
    }
    this._catalogs = [...catalogs];
    this.processor = sharedProcessor ?? new MessageProcessor(this._catalogs as never);
  }

  /**
   * Creates the state of a renderer that renders from `processor`.
   *
   * The state applies each message it accepts to `processor` itself, so the renderer shows a
   * message as soon as the state applies it, and a rollback takes the message back out of the
   * renderer's model. A function call reaches the processor only once the outermost `apply` or
   * transaction it was applied in succeeds, since a function that ran cannot be rolled back.
   *
   * The state checks messages against the surfaces the processor holds, including those it
   * held before, under its own rules whatever rules the processor was created with. The
   * processor must take its messages from the state only: one applied around the state is
   * checked by nothing, and a transaction that fails after it cannot undo it.
   *
   * @param processor The renderer's processor. Its catalogs are the state's catalogs.
   * @throws {A2uiCatalogError} If the processor's catalogs could not make a state, as for the
   *     constructor.
   */
  static of<T extends ComponentApi>(processor: MessageProcessor<T>): RendererState {
    sharedProcessor = processor as unknown as MessageProcessor;
    try {
      return new RendererState(processor.catalogs as unknown as CatalogApi[]);
    } finally {
      sharedProcessor = undefined;
    }
  }

  /** The active catalogs in priority order. */
  get catalogs(): CatalogApi[] {
    return [...this._catalogs];
  }

  /** The ids of the surfaces the renderer holds, in no particular order. */
  get surfaceIds(): string[] {
    return [...this.processor.model.surfacesMap.keys()];
  }

  /** Returns the surface with the id, if the renderer holds it. Callers must not modify it. */
  getSurface(surfaceId: string): SurfaceModel | undefined {
    return this.processor.model.getSurface(surfaceId);
  }

  /**
   * Whether an update to a surface the state never saw created makes an empty placeholder
   * for it instead of being rejected. Only a state that checks one payload on its own, with
   * no record of earlier ones, says yes.
   */
  protected get assumesUnknownSurfaces(): boolean {
    return false;
  }

  /**
   * Checks the messages against the state and applies them.
   *
   * Each message must match the protocol's message schema and state a `version` that the
   * catalogs' protocol version accepts: `v0.9` or `v0.9.1` for v0.9 and v0.9.1, and `v1.0`
   * for v1.0. Each component and function call is checked against the catalog it resolves
   * to, and component ids and cycles against the surface's components. References, the root
   * and reachability are left to `checkTopology`, since a component may name a child that a
   * later message adds.
   *
   * The call is atomic: if a message is rejected, none of them is applied. Being atomic
   * costs what the messages change, not the size of the surfaces they touch.
   *
   * @param payload One message or an iterable of messages, as parsed JSON objects.
   * @returns The ids of the surfaces the messages create, update or delete, in the order the
   *     messages first name them.
   * @throws {A2uiValidationError} If a renderer in this state would reject a message. The
   *     error, or a subclass such as `A2uiIntegrityError`, describes the first problem found.
   */
  apply(payload: unknown): string[] {
    this.checkNoRunaway();
    const messages = extractMessages(payload);
    messages.forEach((message, index) => this.checkMessage(message, index));
    const touched = new Set<string>();
    this.frame(() => {
      for (let index = 0; index < messages.length; index++) {
        const surfaceId = this.applyMessage(messages, index);
        if (surfaceId !== undefined) {
          touched.add(surfaceId);
        }
      }
    });
    return [...touched];
  }

  /**
   * Checks the whole tree of each surface.
   *
   * The surface must have its root, and every reference must resolve. Every component added
   * or replaced since the surface's tree was last checked must be reachable from the root,
   * within the depth limit. A component that an update left unreachable, by rewriting its
   * parent's children, is accepted: the protocol has no message that removes one component,
   * so replacing part of a canvas always leaves such components behind. A surface with no
   * components yet passes, since its components may arrive later. Surfaces that are deleted
   * or assumed are skipped.
   *
   * @throws {A2uiValidationError} If a surface's tree is incomplete or invalid.
   */
  checkTopology(surfaceIds: Iterable<string>): void {
    this.checkNoRunaway();
    const ids = [...new Set(surfaceIds)];
    for (const surfaceId of ids) {
      if (this.assumed.has(surfaceId)) continue;
      const surface = this.processor.model.getSurface(surfaceId);
      if (!surface) continue;
      const components = surface.componentsModel;
      if (components.size === 0) continue;
      const rootId = surface.rootId || 'root';
      const reachable = asValidationError(() => {
        components.validateTopology({...STRICT_VALIDATION, rootId, allowOrphanComponents: true});
        // One walk from the root, which returns what it reached.
        return components.detectCycles({rootId});
      });
      const unreachable = [...(this.changed.get(surfaceId) ?? [])]
        .filter(id => components.has(id) && !reachable.has(id))
        .sort();
      if (unreachable.length > 0) {
        throw new A2uiIntegrityError(
          `Component '${unreachable[0]}' is not reachable from '${rootId}' (Orphaned component '${unreachable[0]}' is not reachable from root)`,
        );
      }
    }
    // An assumed surface was not checked, so what changed on it stays recorded for the check
    // after it is created.
    this.markChecked(ids.filter(s => !this.assumed.has(s)));
  }

  /**
   * Stops holding the components each surface changed against later checks.
   *
   * `checkTopology` calls this for the surfaces it checks. A caller calls it for the surfaces
   * of messages the renderer received that failed a check, such as a stream that failed after
   * it emitted them: no message removes a component, so a component the renderer already
   * holds can't be made reachable later, and the later turns are not held to it. Dangling
   * references and a missing root are still reported, since `checkTopology` checks those on
   * the whole surface. Like any other change, it is undone when the transaction it was made
   * in fails.
   */
  markChecked(surfaceIds: Iterable<string>): void {
    this.checkNoRunaway();
    for (const surfaceId of new Set(surfaceIds)) {
      this.forgetChanged(surfaceId);
    }
  }

  /**
   * Runs `fn` and applies everything it applies atomically.
   *
   * If `fn` throws, the state is restored to what it was when the call started, and the
   * error propagates. Opening a transaction copies nothing, and undoing one costs what was
   * applied inside it. Transactions nest: an inner transaction that fails restores the state
   * to where the inner one started, and the outer one goes on. `fn` must be synchronous: a
   * transaction cannot span an `await`.
   *
   * A JavaScript caller can still pass a function that returns a promise. The transaction
   * then restores the state and throws, but the promise keeps running, and nothing it does
   * after its first `await` could be rolled back. So until it settles, `apply`,
   * `transaction`, `checkTopology` and `markChecked` throw `TypeError`, whoever calls them, and a rejection
   * of the promise is handled, since the caller never got the promise to handle it.
   *
   * @returns What `fn` returns.
   * @throws {TypeError} If `fn` returns a promise, which the type of `fn` rejects at compile
   *   time. The state is restored first. Also thrown while such a promise is running.
   */
  transaction<T>(fn: (state: this) => T extends PromiseLike<unknown> ? never : T): T {
    this.checkNoRunaway();
    return this.frame(() => {
      const result: T = fn(this);
      if (isPromiseLike(result)) {
        this.runaway++;
        const settled = () => {
          this.runaway--;
        };
        Promise.resolve(result).then(settled, settled);
        throw new TypeError('A renderer state transaction must be synchronous.');
      }
      return result;
    });
  }

  /** Throws while a promise that a transaction function returned is still running. */
  private checkNoRunaway(): void {
    if (this.runaway > 0) {
      throw new TypeError(
        'A renderer state takes no changes while a promise that a transaction function returned is still running.',
      );
    }
  }

  /**
   * Runs `fn` and undoes what it changed if it throws.
   *
   * The frame is a position in the undo log. A failure reverts the log to it, so a failed
   * inner frame undoes only what was changed inside it. Once the outermost frame ends,
   * nothing can be undone any more, and the log is cleared. The error `fn` threw propagates,
   * even if an undo fails too.
   */
  private frame<T>(fn: () => T): T {
    const mark = this.log.length;
    this.open++;
    let result: T;
    try {
      result = fn();
    } catch (e) {
      this.revert(mark);
      throw e;
    } finally {
      this.open--;
      if (this.open === 0) this.log.length = 0;
    }
    if (this.open === 0) this.runCalls();
    return result;
  }

  /** Hands the function calls held back to the processor, in the order they were applied. */
  private runCalls(): void {
    const calls = this.calls.splice(0);
    if (calls.length > 0) this.processUnlogged(calls);
  }

  /**
   * Undoes the changes logged after a position, latest first.
   *
   * Every record is undone even if one throws, so that one failure doesn't leave the
   * changes logged before it in place. A record that throws is dropped.
   */
  private revert(mark: number): void {
    while (this.log.length > mark) {
      try {
        this.log.pop()!();
      } catch {
        // Keep undoing; the caller rethrows the error that started the rollback.
      }
    }
  }

  /** Logs how to undo a change, if an `apply` or transaction is open. */
  private record(undo: Undo): void {
    if (this.open > 0) this.log.push(undo);
  }

  // The state's own bookkeeping. Each change goes through one of these, so that it is
  // logged.

  private setAssumed(surfaceId: string, assumed: boolean): void {
    if (this.assumed.has(surfaceId) === assumed) return;
    if (assumed) {
      this.assumed.add(surfaceId);
      this.record(() => this.assumed.delete(surfaceId));
    } else {
      this.assumed.delete(surfaceId);
      this.record(() => this.assumed.add(surfaceId));
    }
  }

  /** Records components a surface added or replaced since its tree was last checked. */
  private noteChanged(surfaceId: string, componentIds: Iterable<string>): void {
    let changed = this.changed.get(surfaceId);
    if (!changed) {
      changed = new Set();
      this.changed.set(surfaceId, changed);
      this.record(() => this.changed.delete(surfaceId));
    }
    const added: string[] = [];
    for (const id of componentIds) {
      if (!changed.has(id)) {
        changed.add(id);
        added.push(id);
      }
    }
    if (added.length > 0) {
      const set = changed;
      this.record(() => added.forEach(id => set.delete(id)));
    }
  }

  /**
   * Holds a function call back until the outermost `apply` or transaction succeeds. The
   * processor reads nothing of it but its envelope, which `checkMessage` has checked.
   */
  private holdCall(message: Message): void {
    this.calls.push(message);
    this.record(() => this.calls.pop());
  }

  /** Stops holding what a surface changed against its next tree check. */
  private forgetChanged(surfaceId: string): void {
    const changed = this.changed.get(surfaceId);
    if (changed === undefined) return;
    this.changed.delete(surfaceId);
    this.record(() => this.changed.set(surfaceId, changed));
  }

  /**
   * Runs one message through the processor, logging what it replaces.
   *
   * The processor checks a message whole before it changes a surface, so a rejected message
   * changes nothing. Should one fail part way all the same, what it changed is undone
   * before the error propagates.
   */
  private process(message: Message): void {
    const undo = this.undoFor(message);
    try {
      this.processUnlogged([message]);
    } catch (e) {
      try {
        undo?.();
      } catch {
        // The error that rejected the message is the one to report.
      }
      throw e;
    }
    if (undo) this.record(undo);
  }

  /** Runs messages through the processor, logging nothing. */
  private processUnlogged(messages: Message[]): void {
    asValidationError(() =>
      this.processor.processMessages(messages as never, {validationConfig: IN_PROGRESS_VALIDATION}),
    );
  }

  /** Returns how to undo a message, read before it is applied, or nothing to undo. */
  private undoFor(message: Message): Undo | undefined {
    const model = this.processor.model;
    const createBody = bodyOf(message, 'createSurface');
    if (createBody) {
      const surfaceId = createBody.surfaceId;
      if (typeof surfaceId !== 'string' || model.getSurface(surfaceId)) return undefined;
      return () => model.deleteSurface(surfaceId);
    }
    const deleteBody = bodyOf(message, 'deleteSurface');
    if (deleteBody) {
      const surfaceId = deleteBody.surfaceId;
      const surface = typeof surfaceId === 'string' ? model.getSurface(surfaceId) : undefined;
      return surface ? this.surfaceRestorer(surface) : undefined;
    }
    const componentsBody = bodyOf(message, 'updateComponents');
    if (componentsBody) {
      return this.componentsRestorer(componentsBody);
    }
    const dataBody = bodyOf(message, 'updateDataModel');
    if (dataBody) {
      return this.dataModelRestorer(dataBody);
    }
    // Function calls and responses change no surface.
    return undefined;
  }

  /**
   * Records the components an `updateComponents` adds or replaces.
   *
   * The core updates a component in place when the update keeps its type and catalog, so
   * the record holds a copy of the component's previous properties, not the object the
   * update replaces them with.
   *
   * When an update changes a component's type or catalog, the core replaces the component
   * with a new one, which goes last in the surface's order. The order is visible: the tree
   * check reports the first problem it meets in it. So for such a component the record also
   * holds its position, and the undo puts the old component back there. Finding a position
   * costs one pass over the surface's components, made only for a message that changes a
   * type or catalog.
   */
  private componentsRestorer(body: Message): Undo | undefined {
    const model = this.processor.model;
    const surfaceId = body.surfaceId;
    if (typeof surfaceId !== 'string' || !Array.isArray(body.components)) return undefined;
    const surface = model.getSurface(surfaceId);
    if (!surface) return undefined;
    const previous: Array<{
      id: string;
      existing: ComponentModel | undefined;
      properties: Record<string, unknown>;
      copy: Record<string, unknown>;
      metadata: Record<string, unknown> | undefined;
    }> = [];
    const replaced = new Set<string>();
    for (const component of body.components as unknown[]) {
      const id = (component as Message | null)?.id;
      if (typeof id !== 'string') continue;
      const existing = surface.componentsModel.get(id);
      previous.push({
        id,
        existing,
        properties: existing?.properties ?? {},
        copy: existing ? structuredClone(existing.properties) : {},
        metadata: existing ? structuredClone(existing.metadata) : undefined,
      });
      if (existing && this.replaces(component as Message, existing, surface)) replaced.add(id);
    }
    if (previous.length === 0) return undefined;
    const positions = new Map<string, number>();
    if (replaced.size > 0) {
      let index = 0;
      for (const id of surface.componentsModel.keys) {
        if (replaced.has(id)) positions.set(id, index);
        index++;
      }
    }
    return () => {
      // Found again by id: undoing a later delete restores the surface into new objects.
      const components = model.getSurface(surfaceId)?.componentsModel;
      if (!components) return;
      const restored: Array<[number, ComponentModel]> = [];
      for (const {id, existing, properties, copy, metadata} of [...previous].reverse()) {
        const current = components.get(id);
        if (!existing) {
          components.removeComponent(id);
        } else if (
          current &&
          current.type === existing.type &&
          current.catalog === existing.catalog
        ) {
          // The component itself, or the copy that undoing a later deleteSurface or type
          // change put back in its place. It is restored in place, so it keeps its position.
          // Left as it was if the message failed before changing it.
          if (current === existing && current.properties === properties) continue;
          current.metadata = metadata;
          current.properties = copy;
        } else {
          // The update replaced the component with one of another type or catalog, and the
          // core disposed of the old one.
          components.removeComponent(id);
          restored.push([
            positions.get(id) ?? Infinity,
            new ComponentModel(id, existing.type, copy, existing.catalog, metadata),
          ]);
        }
      }
      // Once every replacement is removed, the components left are in their old order, so
      // putting the old ones back from the first position on puts each where it was.
      restored.sort(([a], [b]) => a - b);
      for (const [index, component] of restored) {
        components.insertComponent(index, component);
      }
    };
  }

  /**
   * Whether an update to a component makes the core replace it with a new one, as it does
   * when the update changes the component's type or catalog. Mirrors how the core resolves
   * the catalog of a component update.
   */
  private replaces(update: Message, existing: ComponentModel, surface: SurfaceModel): boolean {
    const type = typeof update.component === 'string' ? update.component : existing.type;
    if (type !== existing.type) return true;
    const atLeastV1 = this.releaseLine !== 'v0.9';
    const catalogId = update.catalogId;
    if (typeof catalogId === 'string' && (catalogId !== '' || atLeastV1)) {
      return catalogId !== existing.catalog.id;
    }
    // Below v1.0 an update that names no catalog keeps the component's own; from v1.0 it
    // moves the component to the surface's default catalog.
    return atLeastV1 && surface.defaultCatalog?.id !== existing.catalog.id;
  }

  /**
   * Records the data model value an `updateDataModel` replaces.
   *
   * Setting a path creates the containers above it that are missing, and pads a list up to
   * the index it sets, so the record is taken at the first segment of the path that does not
   * hold a container yet. The value there is replaced, not changed in place, and every later
   * change to it has a record of its own, so the record holds the value itself.
   *
   * The undo leaves the data as it was, as `JSON.stringify` shows it: a hole in a list stays
   * a hole, and a key the message deleted goes back to its place among its object's keys.
   * Finding that place costs one pass over the object's keys, made only for a message that
   * deletes a key.
   */
  private dataModelRestorer(body: Message): Undo | undefined {
    const model = this.processor.model;
    const surfaceId = body.surfaceId;
    if (typeof surfaceId !== 'string') return undefined;
    const surface = model.getSurface(surfaceId);
    if (!surface) return undefined;
    const path = typeof body.path === 'string' ? body.path : '/';
    const tokens = pointerTokens(path);
    const root: unknown = surface.dataModel.get('/');
    if (tokens.length === 0) {
      return () => model.getSurface(surfaceId)?.dataModel.set('/', root);
    }
    let parent: unknown = root;
    for (let depth = 0; depth < tokens.length; depth++) {
      if (!parent || typeof parent !== 'object') return undefined;
      const token = tokens[depth];
      const [exists, child] = childOf(parent, token);
      if (exists && depth < tokens.length - 1 && child && typeof child === 'object') {
        parent = child;
        continue;
      }
      const parentTokens = tokens.slice(0, depth);
      const length = Array.isArray(parent) ? parent.length : 0;
      // Setting a key to nothing deletes it, and putting it back would put it last.
      const deletes =
        exists &&
        !Array.isArray(parent) &&
        depth === tokens.length - 1 &&
        (body.value === undefined || body.value === null);
      const position = deletes ? Object.keys(parent).indexOf(token) : -1;
      return () => {
        const dataModel = model.getSurface(surfaceId)?.dataModel;
        if (!dataModel) return;
        const parentPath = toPointer(parentTokens);
        const container: unknown = dataModel.get(parentPath);
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container)) {
          if (exists) {
            container[Number(token)] = child;
          } else {
            // Within the old length the index was a hole, and past it the list was shorter.
            delete container[Number(token)];
            container.length = length;
          }
        } else if (exists) {
          restoreKey(container as Message, token, child, position);
        } else {
          delete (container as Message)[token];
        }
        // Setting the container to itself tells the model's subscribers it changed.
        dataModel.set(parentPath, container);
      };
    }
    return undefined;
  }

  /**
   * Records a surface that a message deletes, whole.
   *
   * It is restored straight into the model, not replayed through the processor: the
   * processor accepted the surface one message at a time, and replayed as one message it
   * could reject what it accepted, such as a data model deeper than one message may be. Each
   * component keeps its catalog, its place in the surface's order, its properties and its
   * metadata, and the data model its root, whatever JSON value that is. The properties and
   * the data model are copied, since the surface is disposed of once deleted.
   */
  private surfaceRestorer(surface: SurfaceModel): Undo {
    const surfaceId = surface.id;
    const defaultCatalog = surface.defaultCatalog;
    const availableCatalogs = new Map(surface.availableCatalogs);
    const theme: unknown = structuredClone(surface.theme);
    const sendDataModel = surface.sendDataModel;
    const rootId = surface.rootId;
    const metadata = structuredClone(surface.metadata);
    const protocolVersion = surface.protocolVersion;
    const components = [...surface.componentsModel.values].map(component => ({
      id: component.id,
      type: component.type,
      properties: structuredClone(component.properties),
      catalog: component.catalog,
      metadata: structuredClone(component.metadata),
    }));
    const data: unknown = structuredClone(surface.dataModel.get('/'));
    return () => {
      const model = this.processor.model;
      if (model.getSurface(surfaceId)) return;
      const restored = new SurfaceModel(
        surfaceId,
        defaultCatalog,
        availableCatalogs,
        theme,
        sendDataModel,
        undefined,
        rootId,
        metadata,
        protocolVersion,
      );
      restored.dataModel.set('/', data);
      for (const component of components) {
        restored.componentsModel.addComponent(
          new ComponentModel(
            component.id,
            component.type,
            component.properties,
            component.catalog,
            component.metadata,
          ),
        );
      }
      model.addSurface(restored);
    };
  }

  /** Applies the message at `index` and returns the surface it targets, if any. */
  private applyMessage(payload: Message[], index: number): string | undefined {
    const message = payload[index];
    const [surfaceId, creates] = target(message);
    if (surfaceId === undefined) {
      if ('callRendererFunction' in message) {
        this.holdCall(message);
      } else {
        this.process(message);
      }
      return undefined;
    }

    const deletes = 'deleteSurface' in message;
    if (creates) {
      this.process(message);
    } else if (deletes) {
      this.process(message);
      this.setAssumed(surfaceId, false);
      this.forgetChanged(surfaceId);
    } else if (
      !this.processor.model.getSurface(surfaceId) &&
      this.assumes(surfaceId, payload, index)
    ) {
      this.assumeSurface(surfaceId, payload, index);
    } else {
      this.process(message);
    }
    if (!deletes) {
      this.noteChanged(surfaceId, componentIds(message));
    }
    return surfaceId;
  }

  /**
   * Whether an update to a surface the state lacks assumes the surface.
   *
   * A payload state assumes a surface the payload never named before, but not one that an
   * earlier message of the payload deleted, nor one that a later message creates before any
   * message deletes it: a renderer rejects updates to either, since the surface does not
   * exist yet when they arrive.
   */
  private assumes(surfaceId: string, payload: Message[], index: number): boolean {
    if (!this.assumesUnknownSurfaces) return false;
    if (payload.slice(0, index).some(message => target(message)[0] === surfaceId)) {
      return false;
    }
    for (const later of payload.slice(index + 1)) {
      const [targetId, creates] = target(later);
      if (targetId !== surfaceId) continue;
      if (creates) return false;
      if ('deleteSurface' in later) break;
    }
    return true;
  }

  /**
   * Creates a placeholder for an unknown surface and applies the update.
   *
   * The updates to the surface are the message at `index` and the messages after it that
   * update the surface, up to one that creates or deletes it. The surface is created on each
   * catalog that defines every component those updates add, until one accepts all of them,
   * so a later update can rule out a catalog that the first one fits. If none does, the error
   * from the first is thrown. Only the first update is applied here; the others are applied
   * in turn.
   */
  private assumeSurface(surfaceId: string, payload: Message[], index: number): void {
    const message = payload[index];
    const updates = surfaceUpdates(surfaceId, payload, index);
    const types = componentTypes(updates);
    let candidates = this._catalogs.filter(catalog =>
      [...types].every(name => catalog.components.has(name)),
    );
    if (candidates.length === 0) candidates = [this._catalogs[0]];

    const errors: A2uiValidationError[] = [];
    for (const catalog of candidates) {
      const placeholder = {
        version: message.version,
        createSurface: {surfaceId, catalogId: catalog.id},
      };
      try {
        // A trial on a surface deleted right after, which needs no undo.
        this.processUnlogged([placeholder, ...updates]);
      } catch (e) {
        if (!(e instanceof A2uiValidationError)) throw e;
        errors.push(e);
        continue;
      } finally {
        this.processor.model.deleteSurface(surfaceId);
      }
      this.process(placeholder);
      this.process(message);
      this.setAssumed(surfaceId, true);
      return;
    }
    throw errors[0];
  }

  /**
   * Throws if a message states the wrong version or doesn't match its schema.
   *
   * The version is checked first, since the envelope schemas require their own version and
   * would report a wrong one less clearly.
   */
  private checkMessage(message: Message, index: number): void {
    const accepted = MESSAGE_VERSIONS[this.releaseLine];
    const stated = message.version;
    if (typeof stated === 'string' && accepted.includes(stated)) {
      validateEnvelope(message, this.releaseLine);
      return;
    }
    if (stated === undefined || stated === null) {
      throw new A2uiValidationError(
        `Message ${index} states no version, which ${this.releaseLine} messages require.`,
      );
    }
    const quoted = [...accepted]
      .sort()
      .map(v => `'${v}'`)
      .join(' or ');
    throw new A2uiValidationError(
      `Message ${index} states version '${String(stated)}', but the catalogs target ${this.releaseLine}, whose messages state ${quoted}.`,
    );
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

/**
 * Runs `fn`, throwing the core's errors as validation errors.
 *
 * Errors of other kinds, such as a catalog that a message names but the processor doesn't
 * hold, come from the payload too.
 */
function asValidationError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof A2uiValidationError || !(e instanceof A2uiError)) throw e;
    throw new A2uiValidationError(e.message, (e as {details?: unknown}).details);
  }
}

function isObjectIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value;
}

/** Normalizes a payload into a list of message objects, each a copy of the original. */
function extractMessages(payload: unknown): Message[] {
  const items = isObjectIterable(payload) ? [...payload] : [payload];
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || isObjectIterable(item)) {
      throw new A2uiValidationError(`Message ${index} is not a JSON object.`);
    }
    return structuredClone(item as Message);
  });
}

/**
 * Returns the surface that a message targets and whether it creates it.
 *
 * A message that holds more than one action is malformed. It targets no surface, so the
 * processor sees it as is and rejects it.
 */
function target(message: Message): [string | undefined, boolean] {
  const actions = [...CREATE_ACTIONS, ...UPDATE_ACTIONS].filter(a => a in message);
  if (actions.length !== 1) return [undefined, false];
  const action = actions[0];
  const body = message[action];
  if (body && typeof body === 'object') {
    const surfaceId = (body as Message).surfaceId;
    if (typeof surfaceId === 'string') {
      return [surfaceId, (CREATE_ACTIONS as readonly string[]).includes(action)];
    }
  }
  return [undefined, false];
}

/**
 * The updates to a surface from `index` of a payload on. They end before the next message
 * that creates or deletes the surface.
 */
function surfaceUpdates(surfaceId: string, payload: Message[], index: number): Message[] {
  const updates: Message[] = [];
  for (const message of payload.slice(index)) {
    const [targetId, creates] = target(message);
    if (targetId !== surfaceId) continue;
    if (updates.length > 0 && (creates || 'deleteSurface' in message)) break;
    updates.push(message);
  }
  return updates;
}

/** Returns the component list of each action of a message that holds one. */
function componentLists(message: Message): unknown[][] {
  const lists: unknown[][] = [];
  for (const action of ['createSurface', 'updateComponents']) {
    const body = message[action];
    const components = body && typeof body === 'object' ? (body as Message).components : undefined;
    if (Array.isArray(components)) {
      lists.push(components);
    }
  }
  return lists;
}

/** Returns the ids of the components a message adds or replaces. */
function componentIds(message: Message): Set<string> {
  const ids = new Set<string>();
  for (const components of componentLists(message)) {
    for (const component of components) {
      const id = (component as Message | null)?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

/**
 * Returns the component types that messages add to their surface.
 *
 * Components that name a catalog of their own are left out, since they don't use the
 * surface's catalog.
 */
function componentTypes(messages: Message[]): Set<string> {
  const types = new Set<string>();
  for (const message of messages) {
    for (const components of componentLists(message)) {
      for (const component of components) {
        if (!component || typeof component !== 'object' || 'catalogId' in component) continue;
        const type = (component as Message).component;
        if (typeof type === 'string') types.add(type);
      }
    }
  }
  return types;
}

/** Returns the body of a message's action, if the message holds that action. */
function bodyOf(message: Message, action: string): Message | undefined {
  const body = message[action];
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Message) : undefined;
}

/** Splits a JSON Pointer into its unescaped segments, as `DataModel` does. */
function pointerTokens(path: string): string[] {
  return path
    .split('/')
    .filter(token => token.length > 0)
    .map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Joins segments into a JSON Pointer. */
function toPointer(tokens: string[]): string {
  return '/' + tokens.map(token => token.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

/**
 * Returns whether a container holds a segment of a path, and its value. A hole in a list
 * holds nothing.
 */
function childOf(container: object, token: string): [boolean, unknown] {
  if (Array.isArray(container)) {
    if (!INDEX.test(token)) return [false, undefined];
    const index = Number(token);
    return Object.prototype.hasOwnProperty.call(container, index)
      ? [true, container[index]]
      : [false, undefined];
  }
  return Object.prototype.hasOwnProperty.call(container, token)
    ? [true, (container as Message)[token]]
    : [false, undefined];
}

/**
 * Sets a key of an object back to its value. A key that is missing goes back to `position`
 * among the object's keys, or last if the position is unknown.
 */
function restoreKey(container: Message, key: string, value: unknown, position: number): void {
  if (position < 0 || Object.prototype.hasOwnProperty.call(container, key)) {
    container[key] = value;
    return;
  }
  const after = Object.keys(container).slice(position);
  const values = after.map(k => container[k]);
  for (const k of after) delete container[k];
  container[key] = value;
  after.forEach((k, i) => {
    container[k] = values[i];
  });
}
