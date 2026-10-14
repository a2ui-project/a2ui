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

import {DataModel} from './data-model.js';
import {Catalog, ComponentApi, FunctionApi, FunctionImplementation} from '../catalog/types.js';
import {SurfaceComponentsModel} from './surface-components-model.js';
import {EventEmitter, EventSource} from '../common/events.js';
import {toCanonicalVersion} from '../common/semver.js';
import {resolveSurfaceCatalog} from './resolve-surface-catalog.js';

/**
 * Normalizes a protocol version to the `vMAJOR.MINOR` form used by messages.
 *
 * Catalogs declare `'1.0'` while messages carry `'v1.0'`; storing one form
 * keeps comparisons by consumers simple. Unparseable versions are kept as is.
 *
 * @param version Protocol version to normalize.
 * @returns The canonical version, or `undefined` when none was given.
 */
function canonicalProtocolVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const canonical = toCanonicalVersion(version);
  return canonical ? `v${canonical}` : version;
}

/** Action payload emitted by a renderer component. */
export interface ActionPayload {
  /** Name of the action or function being invoked. */
  name: string;
  /** Identifier of the surface where the action originated. */
  surfaceId: string;
  /** Identifier of the component that triggered the action. */
  sourceComponentId: string;
  /** ISO 8601 timestamp recorded when the action was dispatched. */
  timestamp: string;
  /** Context parameters or arguments passed with the action. */
  context: Record<string, unknown>;
  /**
   * Identifier of the catalog that declares the invoked function, when the
   * payload named one explicitly. Absent when the surface's default catalog
   * resolved the call.
   */
  catalogId?: string;
  /** Optional user-facing message explaining the action. */
  userMessage?: string;
  [key: string]: unknown;
}

/** Error payload emitted by a surface. */
export interface A2uiErrorPayload {
  /** Machine-readable error code identifying the error category. */
  code: string;
  /** Human-readable error message describing the failure. */
  message: string;
  /** Identifier of the surface where the error occurred, if applicable. */
  surfaceId?: string;
  /** Expression string or function name that caused the error, if applicable. */
  expression?: string;
  /** Additional diagnostic details or validation issues. */
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Payload emitted on `SurfaceModel.onWarning` when a non-fatal condition
 * occurs during surface evaluation (such as a bound JSON Pointer that does not
 * physically exist in the active DataModel).
 */
export interface A2uiWarningPayload {
  /** Machine-readable warning code (e.g. `'MISSING_DATA_BINDING'`). */
  code: 'MISSING_DATA_BINDING' | (string & {});
  /** Absolute JSON pointer path associated with the warning, if applicable. */
  path?: string;
  /** Human-readable explanation of the warning condition. */
  message: string;
  /** Identifier of the surface where the warning occurred, if bound. */
  surfaceId?: string;
  [key: string]: unknown;
}

/** Handler callback for actions emitted from a surface. */
export type ActionListener = (action: ActionPayload) => void | Promise<void>;

/**
 * State model for a single UI surface.
 *
 * Coordinates data binding, component state, and action dispatching.
 *
 * @template T Concrete type of the ComponentApi from the catalog.
 * @template F The catalog's function kind. Every state and messaging
 *   capability of the surface works with a schema-only catalog
 *   (`SurfaceModel<T, FunctionApi>`); only node-tree resolution needs
 *   implementations.
 */
export class SurfaceModel<
  T extends ComponentApi = ComponentApi,
  F extends FunctionApi = FunctionImplementation,
> {
  /** Data model for this surface. */
  readonly dataModel: DataModel;
  /** Collection of component models for this surface. */
  readonly componentsModel: SurfaceComponentsModel;

  private readonly _onAction = new EventEmitter<ActionPayload>();
  private readonly _onError = new EventEmitter<A2uiErrorPayload>();
  private readonly _onWarning = new EventEmitter<A2uiWarningPayload>();

  /** Event source firing whenever an action is dispatched from this surface. */
  readonly onAction: EventSource<ActionPayload> = this._onAction;

  /** Event source firing whenever an error occurs on this surface. */
  readonly onError: EventSource<A2uiErrorPayload> = this._onError;

  /** Event source firing whenever a non-fatal warning occurs on this surface. */
  readonly onWarning: EventSource<A2uiWarningPayload> = this._onWarning;

  /**
   * Catalogs available to this surface, keyed by catalog ID.
   *
   * Payloads on this surface may select any of these catalogs by `catalogId`.
   * Includes the surface's {@link defaultCatalog} under its identifier.
   */
  readonly availableCatalogs: ReadonlyMap<string, Catalog<T, F>>;

  /**
   * Protocol version this surface speaks.
   *
   * Defaults to the default catalog's version. A surface without a default
   * catalog (allowed from v1.0) takes it from the `protocolVersion`
   * constructor argument instead. Stored in the `vMAJOR.MINOR` form used by
   * messages (for example `'v1.0'`), whichever form it was given in.
   */
  readonly protocolVersion: string | undefined;

  /**
   * Initializes a new `SurfaceModel` instance.
   *
   * @param id Unique identifier for this surface.
   * @param defaultCatalog Catalog that resolves components and functions that
   *   do not name a catalog explicitly. From v1.0 a surface may have none, in
   *   which case every component and function call must name its catalog.
   * @param availableCatalogs Every catalog a payload on this surface may select
   *   by `catalogId`, keyed by that identifier. The message processor populates
   *   it with the catalogs whose protocol version is compatible with the
   *   surface's own.
   * @param theme Theme to apply to this surface.
   * @param sendDataModel Whether the renderer sends the full data model with actions.
   * @param dataModel Optional custom DataModel instance. If provided, the SurfaceModel assumes
   *   full ownership of its lifecycle and will dispose it when dispose() is called.
   * @param rootId Identifier of the root component on this surface (defaults to `'root'`).
   * @param metadata Optional surface-level metadata for vendor extensions.
   * @param protocolVersion Protocol version of the surface. Defaults to the
   *   default catalog's version; surfaces without a default catalog pass it
   *   explicitly.
   */
  constructor(
    readonly id: string,
    /**
     * Catalog that resolves components and functions that do not name a
     * catalog explicitly, or `undefined` when the surface names none.
     */
    readonly defaultCatalog: Catalog<T, F> | undefined,
    availableCatalogs: ReadonlyMap<string, Catalog<T, F>> | null | undefined = new Map(),
    readonly theme: any = {},
    readonly sendDataModel: boolean = false,
    dataModel?: DataModel,
    /** Identifier of the root component on this surface (defaults to `'root'`). */
    readonly rootId: string = 'root',
    /** Optional surface-level metadata for vendor extensions. */
    readonly metadata?: Record<string, unknown>,
    protocolVersion?: string,
  ) {
    this.protocolVersion = canonicalProtocolVersion(
      protocolVersion ?? defaultCatalog?.protocolVersion,
    );
    if (
      availableCatalogs !== undefined &&
      availableCatalogs !== null &&
      !(availableCatalogs instanceof Map)
    ) {
      throw new TypeError(
        'availableCatalogs must be a Map, or undefined/null. Note that availableCatalogs is now the 3rd argument to SurfaceModel and theme is the 4th argument.',
      );
    }
    const catalogs = new Map(availableCatalogs ?? []);
    if (defaultCatalog?.id && !catalogs.has(defaultCatalog.id)) {
      catalogs.set(defaultCatalog.id, defaultCatalog);
    }
    this.availableCatalogs = catalogs;
    this.dataModel = dataModel ?? new DataModel({});
    this.componentsModel = new SurfaceComponentsModel(defaultCatalog);
  }

  /**
   * The surface's default catalog.
   *
   * @deprecated Use {@link defaultCatalog}. Renamed for symmetry with the other
   *   SDKs now that a surface can carry more than one catalog. This alias will
   *   be removed in a future release.
   */
  get catalog(): Catalog<T, F> | undefined {
    return this.defaultCatalog;
  }

  /**
   * Resolves the catalog that an item on this surface uses.
   *
   * An item that names a catalog uses that entry of {@link availableCatalogs};
   * one that names none uses the {@link defaultCatalog}. Both the message
   * processor, when validating a payload, and `DataContext`, when running a
   * function call, resolve catalogs through this method.
   *
   * @param catalogId Catalog the item names, or `undefined` when it names none.
   * @param subject Description of the item for error messages, such as
   *   `Function call 'formatDate'`.
   * @returns The catalog the item resolves to.
   * @throws {A2uiCatalogError} If the named catalog is not available on this
   *   surface, or if the item names none and the surface has no default
   *   catalog.
   */
  resolveCatalog(catalogId: string | undefined, subject = 'Item'): Catalog<T, F> {
    return resolveSurfaceCatalog(this, catalogId, subject);
  }

  /**
   * Dispatches an action from this surface to registered listeners.
   *
   * Resolves event action payload details, propagates any explicit `catalogId`,
   * and emits an `ActionPayload` via `onAction`. Local function actions (`functionCall`)
   * are executed locally and are not emitted as agent actions.
   *
   * @param payload Action payload (name and context) to dispatch.
   * @param sourceComponentId Identifier of the component that triggered the action.
   * @returns A promise that resolves once all registered listeners have processed the action.
   */
  async dispatchAction(payload: any, sourceComponentId: string): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const eventPayload = extractActionTarget(payload);
    if (!eventPayload) {
      return;
    }

    const name = eventPayload.name;
    if (!name || typeof name !== 'string') {
      return;
    }

    const rawContext = eventPayload.context;
    const context =
      rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
        ? (rawContext as Record<string, unknown>)
        : {};

    const actionToDispatch: ActionPayload = {
      name,
      surfaceId: this.id,
      sourceComponentId,
      timestamp: new Date().toISOString(),
      context,
    };

    // Only set the key when the payload named a catalog, so listeners can
    // distinguish an explicit override from default-catalog resolution.
    const catalogId = eventPayload.catalogId ?? payload.catalogId;
    if (typeof catalogId === 'string' && catalogId) {
      actionToDispatch.catalogId = catalogId;
    }

    if (typeof eventPayload.userMessage === 'string' && eventPayload.userMessage.length > 0) {
      actionToDispatch.userMessage = eventPayload.userMessage;
    }

    await this._onAction.emit(actionToDispatch);
  }

  /**
   * Dispatches an error from this surface to registered listeners.
   *
   * @param error Error payload to dispatch, conforming to the renderer-to-agent schema.
   * @returns A promise that resolves once all registered listeners have processed the error.
   */
  async dispatchError(error: A2uiErrorPayload): Promise<void> {
    await this._onError.emit({
      ...error,
      surfaceId: this.id,
    });
  }

  /**
   * Dispatches a non-fatal warning from this surface to registered listeners.
   *
   * @param warning The warning payload to dispatch.
   * @returns Promise that resolves once listeners have handled the warning.
   */
  async dispatchWarning(warning: A2uiWarningPayload): Promise<void> {
    await this._onWarning.emit({
      ...warning,
      surfaceId: this.id,
    });
  }

  /**
   * Disposes the surface, data model, components, and event emitters.
   */
  dispose(): void {
    this.dataModel.dispose();
    this.componentsModel.dispose();
    this._onAction.dispose();
    this._onError.dispose();
    this._onWarning.dispose();
  }
}

/**
 * Extracts the inner action target payload (`event` or direct action payload).
 *
 * @param payload Raw action payload object.
 * @returns The unwrapped action object, or `null` if none is present.
 */
function extractActionTarget(payload: Record<string, any>): Record<string, any> | null {
  if ('event' in payload && payload.event && typeof payload.event === 'object') {
    return payload.event;
  }
  if ('name' in payload && typeof payload.name === 'string') {
    return payload;
  }
  return null;
}
