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
  ComponentModel,
  DataModel,
  linkCatalogs,
  MessageProcessor,
  STRICT_VALIDATION,
  SurfaceModel,
  ValidationConfig,
} from '../internal/web-core.js';
import {validateEnvelope} from './envelope-validation.js';
import {checkParserCatalogs} from './catalog-checks.js';

/**
 * The `version` values that messages for each release line's catalogs state, spelled as
 * the specification spells them. As in the core's catalog compatibility, v0.9 and v0.9.1
 * catalogs are interchangeable, so both accept either version.
 */
const MESSAGE_VERSIONS: Readonly<Record<string, readonly string[]>> = {
  'v0.9': ['v0.9', 'v0.9.1'],
  'v1.0': ['v1.0'],
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

/** A surface as it was before a frame first changed it. */
interface SurfaceSnapshot {
  readonly surface: SurfaceModel | undefined;
  readonly assumed: boolean;
  readonly changed: ReadonlySet<string> | undefined;
}

/** What a failed `apply` or transaction restores. */
interface Frame {
  readonly surfaces: Map<string, SurfaceSnapshot>;
}

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
 * The state holds the surfaces as they now stand, not the messages that built them.
 *
 * An update to a surface the state never saw created is rejected, as the renderer would
 * reject it.
 *
 * The state is authoritative for surfaces and their components. The data model values it
 * holds can drift from the renderer's, since the user edits bound inputs there, but no
 * check depends on them.
 */
export class RendererState {
  private readonly _catalogs: CatalogApi[];
  private readonly releaseLine: string;
  private readonly processor: MessageProcessor;
  private readonly assumed = new Set<string>();
  /** The components each surface added or replaced since its tree was last checked. */
  private readonly changed = new Map<string, Set<string>>();
  private readonly frames: Frame[] = [];

  /**
   * Creates the empty state of a renderer that holds the catalogs.
   *
   * @param catalogs The active catalogs, which must target compatible protocol versions.
   *     Each surface is checked against the catalog its `catalogId` names.
   * @throws {A2uiCatalogError} If no catalogs are given, if two share an id, or if their
   *     messages state different versions, for example v0.9 and v1.0 catalogs.
   */
  constructor(catalogs: CatalogApi[]) {
    if (!catalogs || catalogs.length === 0) {
      throw new A2uiCatalogError('A renderer state requires at least one catalog.');
    }
    this.releaseLine = releaseLineOf(checkParserCatalogs(catalogs));
    this._catalogs = linkCatalogs(catalogs);
    this.processor = new MessageProcessor(this._catalogs as never, undefined, {
      validationConfig: IN_PROGRESS_VALIDATION,
    });
  }

  /** The active catalogs in priority order. */
  get catalogs(): CatalogApi[] {
    return [...this._catalogs];
  }

  /** The ids of the surfaces the renderer holds. */
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
   * The call is atomic: if a message is rejected, none of them is applied.
   *
   * @param payload One message or an iterable of messages, as parsed JSON objects.
   * @returns The ids of the surfaces the messages create, update or delete, in the order the
   *     messages first name them.
   * @throws {A2uiValidationError} If a renderer in this state would reject a message. The
   *     error, or a subclass such as `A2uiIntegrityError`, describes the first problem found.
   */
  apply(payload: unknown): string[] {
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
    for (const surfaceId of ids) {
      if (this.changed.get(surfaceId)?.size) {
        this.save(surfaceId);
        this.changed.delete(surfaceId);
      }
    }
  }

  /**
   * Runs `fn` and applies everything it applies atomically.
   *
   * If `fn` throws, the state is restored to what it was when the call started, and the
   * error propagates. `fn` must be synchronous: a transaction cannot span an `await`.
   *
   * @returns What `fn` returns.
   * @throws {TypeError} If `fn` returns a promise, which the type of `fn` rejects at compile
   *   time. The state is restored first.
   */
  transaction<T>(fn: (state: this) => T extends PromiseLike<unknown> ? never : T): T {
    return this.frame(() => {
      const result: T = fn(this);
      if (isPromiseLike(result)) {
        throw new TypeError('A renderer state transaction must be synchronous.');
      }
      return result;
    });
  }

  private frame<T>(fn: () => T): T {
    const frame: Frame = {surfaces: new Map()};
    this.frames.push(frame);
    try {
      return fn();
    } catch (e) {
      this.rollback(frame);
      throw e;
    } finally {
      this.frames.pop();
    }
  }

  private rollback(frame: Frame): void {
    const model = this.processor.model;
    for (const [surfaceId, snapshot] of frame.surfaces) {
      model.deleteSurface(surfaceId);
      if (snapshot.surface) {
        // The snapshot may be shared with an outer frame, so a copy of it goes live and the
        // snapshot itself stays as it was.
        model.addSurface(cloneSurface(snapshot.surface));
      }
      if (snapshot.assumed) {
        this.assumed.add(surfaceId);
      } else {
        this.assumed.delete(surfaceId);
      }
      if (snapshot.changed === undefined) {
        this.changed.delete(surfaceId);
      } else {
        this.changed.set(surfaceId, new Set(snapshot.changed));
      }
    }
  }

  /** Snapshots a surface for every open frame, before the surface changes. */
  private save(surfaceId: string): void {
    const frames = this.frames.filter(f => !f.surfaces.has(surfaceId));
    if (frames.length === 0) return;
    const surface = this.processor.model.getSurface(surfaceId);
    const changed = this.changed.get(surfaceId);
    const snapshot: SurfaceSnapshot = {
      surface: surface ? cloneSurface(surface) : undefined,
      assumed: this.assumed.has(surfaceId),
      changed: changed ? new Set(changed) : undefined,
    };
    for (const frame of frames) {
      frame.surfaces.set(surfaceId, snapshot);
    }
  }

  /** Runs messages through the processor. */
  private process(messages: Message[]): void {
    asValidationError(() => this.processor.processMessages(messages as never));
  }

  /** Applies the message at `index` and returns the surface it targets, if any. */
  private applyMessage(payload: Message[], index: number): string | undefined {
    const message = payload[index];
    const [surfaceId, creates] = target(message);
    if (surfaceId === undefined) {
      this.process([message]);
      return undefined;
    }

    this.save(surfaceId);
    const deletes = 'deleteSurface' in message;
    if (creates) {
      this.process([message]);
    } else if (deletes) {
      this.process([message]);
      this.assumed.delete(surfaceId);
      this.changed.delete(surfaceId);
    } else if (
      !this.processor.model.getSurface(surfaceId) &&
      this.assumes(surfaceId, payload, index)
    ) {
      this.assumeSurface(surfaceId, payload, index);
    } else {
      this.process([message]);
    }
    if (!deletes) {
      let changed = this.changed.get(surfaceId);
      if (!changed) {
        changed = new Set();
        this.changed.set(surfaceId, changed);
      }
      for (const id of componentIds(message)) {
        changed.add(id);
      }
    }
    return surfaceId;
  }

  /**
   * Whether an update to a surface the state lacks assumes the surface.
   *
   * A payload state assumes a surface the payload never named before, but not one that an
   * earlier message of the payload deleted: a renderer rejects updates to it.
   */
  private assumes(surfaceId: string, payload: Message[], index: number): boolean {
    return (
      this.assumesUnknownSurfaces &&
      payload.slice(0, index).every(message => target(message)[0] !== surfaceId)
    );
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
        this.process([placeholder, ...updates]);
      } catch (e) {
        if (!(e instanceof A2uiValidationError)) throw e;
        errors.push(e);
        continue;
      } finally {
        this.processor.model.deleteSurface(surfaceId);
      }
      this.process([placeholder, message]);
      this.assumed.add(surfaceId);
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

/** The release line of a wire protocol version: v0.9.1 shares v0.9's. */
function releaseLineOf(wireVersion: string): string {
  return wireVersion === 'v0.9.1' ? 'v0.9' : wireVersion;
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

/** Copies a surface's state into a new surface that shares its catalogs. */
function cloneSurface(surface: SurfaceModel): SurfaceModel {
  const clone = new SurfaceModel(
    surface.id,
    surface.defaultCatalog,
    surface.availableCatalogs,
    structuredClone(surface.theme),
    surface.sendDataModel,
    new DataModel(structuredClone(surface.dataModel.get('/') ?? {})),
    surface.rootId,
    structuredClone(surface.metadata),
    surface.protocolVersion,
  );
  for (const component of surface.componentsModel.values) {
    clone.componentsModel.addComponent(
      new ComponentModel(
        component.id,
        component.type,
        structuredClone(component.properties),
        component.catalog,
        structuredClone(component.metadata),
      ),
    );
  }
  return clone;
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
