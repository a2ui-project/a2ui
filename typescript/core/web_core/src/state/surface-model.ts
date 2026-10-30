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
import {isAtLeastVersion, toCanonicalVersion} from '../common/semver.js';
import {findFailedArgument, isThenable, settleDeep} from '../common/settle_deep.js';
import {A2uiExpressionError, A2uiRpcError, RpcErrorCode} from '../errors.js';
import {resolveSurfaceCatalog} from './resolve-surface-catalog.js';

/**
 * Normalizes a protocol version to the canonical wire form (`'1.0'` for 1.0+,
 * `'v0.9'` / `'v0.8'` for pre-1.0 versions).
 *
 * Unparseable versions are kept as is.
 *
 * @param version Protocol version to normalize.
 * @returns The canonical version, or `undefined` when none was given.
 */
function canonicalProtocolVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const canonical = toCanonicalVersion(version);
  if (!canonical) return version;
  return isAtLeastVersion(canonical, '1.0') ? canonical : `v${canonical}`;
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
 * A function call that a surface routes to the agent.
 *
 * Unlike a `FunctionCall` in a payload, it always names the catalog the call
 * resolved to, and its arguments are resolved values.
 */
export interface AgentFunctionCall {
  /** Name of the function to call. */
  '@call': string;
  /** Identifier of the catalog the call resolved to on the surface. */
  catalogId: string;
  /** Resolved argument values. */
  args: Record<string, unknown>;
}

/**
 * Sends a function call to the agent and resolves with the agent's result.
 *
 * `MessageProcessor` installs one on each v1.0 surface when it has an
 * outbound listener; it dispatches `callAgentFunction` through the
 * processor's `RpcHandler`.
 */
export type AgentFunctionCaller = (call: AgentFunctionCall) => Promise<unknown>;

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
   * constructor argument instead. Stored in the canonical wire form used by
   * messages (for example `'1.0'` or `'v0.9'`), whichever form it was given in.
   */
  readonly protocolVersion: string | undefined;

  /** Theme visual configuration for this surface. */
  readonly theme: any;

  /** Whether the surface sends its full data model back with actions. */
  readonly sendDataModel: boolean;

  /**
   * Sends calls to functions the renderer does not implement to the agent.
   *
   * When set, a v1.0 catalog's invoker routes a call whose function has no
   * local implementation in that catalog (undeclared, or declared
   * schema-only) here instead of failing, as the v1.0 fallback routing
   * defines. When unset, such a call fails with an `EXPRESSION_ERROR`.
   */
  agentFunctionCaller?: AgentFunctionCaller;

  /** Agent function calls awaiting a response, keyed by canonical call key. */
  private readonly inFlightAgentCalls = new Map<
    string,
    {
      promise: Promise<unknown>;
      signals: Set<AbortSignal>;
      hasUnabortedCaller: boolean;
    }
  >();
  /**
   * Settled reactive agent function answers, keyed by canonical call key in
   * insertion/access order (bounded to {@link MAX_AGENT_CALL_CACHE_ENTRIES}).
   */
  private readonly settledAgentCalls = new Map<string, {value: unknown}>();
  private isDisposed = false;

  /**
   * Whether this surface has been disposed.
   */
  get disposed(): boolean {
    return this.isDisposed;
  }

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
   *   surface's own. Passing a plain object here is deprecated: it selects the
   *   pre-1.0 argument order `(id, catalog, theme, sendDataModel?, dataModel?)`,
   *   in which the object is the theme and the two arguments after it shift.
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
    id: string,
    defaultCatalog: Catalog<T, F> | undefined,
    availableCatalogs?: ReadonlyMap<string, Catalog<T, F>> | null,
    theme?: any,
    sendDataModel?: boolean,
    dataModel?: DataModel,
    rootId?: string,
    metadata?: Record<string, unknown>,
    protocolVersion?: string,
  );
  /**
   * Initializes a new `SurfaceModel` with the pre-1.0 argument order.
   *
   * @deprecated Pass `availableCatalogs` (or `undefined`) as the third argument instead.
   */
  constructor(
    id: string,
    defaultCatalog: Catalog<T, F> | undefined,
    theme: Record<string, any>,
    sendDataModel?: boolean,
    dataModel?: DataModel,
  );
  constructor(
    readonly id: string,
    /**
     * Catalog that resolves components and functions that do not name a
     * catalog explicitly, or `undefined` when the surface names none.
     */
    readonly defaultCatalog: Catalog<T, F> | undefined,
    availableCatalogsOrTheme:
      | ReadonlyMap<string, Catalog<T, F>>
      | Record<string, any>
      | null
      | undefined = new Map(),
    themeOrSendDataModel: any = {},
    sendDataModelOrDataModel: boolean | DataModel = false,
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
    let availableCatalogs: ReadonlyMap<string, Catalog<T, F>> | null | undefined;
    let theme: any = {};
    let sendDataModel = false;

    if (
      availableCatalogsOrTheme !== undefined &&
      availableCatalogsOrTheme !== null &&
      !(availableCatalogsOrTheme instanceof Map)
    ) {
      if (
        typeof availableCatalogsOrTheme === 'object' &&
        !Array.isArray(availableCatalogsOrTheme)
      ) {
        // Legacy v0.9 signature:
        // `new SurfaceModel(id, catalog, theme, sendDataModel?, dataModel?)`.
        // A plain object in the third slot is the theme of a pre-1.0 caller,
        // which had no catalogs to pass here, so the arguments after it
        // shift by one as well.
        theme = availableCatalogsOrTheme;
        sendDataModel = themeOrSendDataModel === true;
        dataModel =
          (sendDataModelOrDataModel as unknown) instanceof DataModel
            ? (sendDataModelOrDataModel as unknown as DataModel)
            : undefined;
        availableCatalogs = undefined;
      } else {
        throw new TypeError(
          'availableCatalogs must be a Map, or undefined/null. Note that availableCatalogs is now the 3rd argument to SurfaceModel and theme is the 4th argument.',
        );
      }
    } else {
      availableCatalogs = availableCatalogsOrTheme;
      theme = themeOrSendDataModel ?? {};
      sendDataModel = Boolean(sendDataModelOrDataModel);
    }
    this.theme = theme;
    this.sendDataModel = sendDataModel;
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
   *   be removed in a future release. Typed as always present because every
   *   pre-1.0 surface has a default catalog.
   */
  get catalog(): Catalog<T, F> {
    return this.defaultCatalog!;
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
   * Sends a function call to the agent through {@link agentFunctionCaller}.
   *
   * For reactive bindings, a settled answer for the same catalog, function and
   * canonical arguments is returned from the surface cache, and a call
   * identical to one still awaiting its response shares that response instead
   * of sending another message, so re-evaluating a binding or flipping a bound
   * argument back does not repeat the request. Failed calls are evicted on
   * failure, and imperative action calls (`bypassCache`) always execute fresh.
   *
   * @param call The call to send, naming the catalog it resolved to.
   * @param abortSignal Optional signal cancelling this caller's interest before
   *   the request leaves on the next microtask.
   * @param options Optional settings (`bypassCache` for imperative action calls).
   * @returns A promise resolving to the agent's result.
   * @throws {A2uiExpressionError} Through the returned promise, if no
   *   {@link agentFunctionCaller} is set.
   */
  callAgentFunction(
    call: AgentFunctionCall,
    abortSignal?: AbortSignal,
    options?: {bypassCache?: boolean},
  ): Promise<unknown> {
    if (this.isDisposed) {
      return Promise.reject(
        new A2uiRpcError(`Surface '${this.id}' has been disposed.`, RpcErrorCode.CANCELLED),
      );
    }
    const caller = this.agentFunctionCaller;
    if (!caller) {
      return Promise.reject(
        new A2uiExpressionError(
          `Function '${call['@call']}' is not implemented locally and surface '${this.id}' cannot call the agent.`,
          call['@call'],
        ),
      );
    }
    if (abortSignal?.aborted) {
      return Promise.resolve(undefined);
    }
    const bypassCache = Boolean(options?.bypassCache);
    const key = bypassCache ? undefined : agentCallKey(call);
    if (key !== undefined) {
      const settled = this.settledAgentCalls.get(key);
      if (settled !== undefined) {
        // Refresh LRU order.
        this.settledAgentCalls.delete(key);
        this.settledAgentCalls.set(key, settled);
        return Promise.resolve(settled.value);
      }
      const inFlight = this.inFlightAgentCalls.get(key);
      if (inFlight) {
        if (abortSignal) {
          inFlight.signals.add(abortSignal);
        } else {
          inFlight.hasUnabortedCaller = true;
        }
        return inFlight.promise;
      }
    }
    const entry = {
      promise: undefined as unknown as Promise<unknown>,
      signals: new Set<AbortSignal>(abortSignal ? [abortSignal] : []),
      hasUnabortedCaller: !abortSignal,
    };
    const release = () => {
      if (key !== undefined && this.inFlightAgentCalls.get(key) === entry) {
        this.inFlightAgentCalls.delete(key);
      }
    };
    const pending = Promise.resolve().then(() => {
      if (this.isDisposed || this.agentFunctionCaller !== caller) {
        release();
        throw new A2uiRpcError(
          `Surface '${this.id}' was disposed before agent function '${call['@call']}' could be sent.`,
          RpcErrorCode.CANCELLED,
        );
      }
      if (!entry.hasUnabortedCaller && Array.from(entry.signals).every(s => s.aborted)) {
        release();
        return undefined;
      }
      return caller(call).then(
        val => {
          release();
          if (key !== undefined && !this.isDisposed) {
            this.settledAgentCalls.delete(key);
            if (this.settledAgentCalls.size >= MAX_AGENT_CALL_CACHE_ENTRIES) {
              const oldestKey = this.settledAgentCalls.keys().next().value;
              if (oldestKey !== undefined) {
                this.settledAgentCalls.delete(oldestKey);
              }
            }
            this.settledAgentCalls.set(key, {value: val});
          }
          return val;
        },
        err => {
          release();
          throw err;
        },
      );
    });
    entry.promise = pending;
    if (key !== undefined) {
      this.inFlightAgentCalls.set(key, entry);
      pending.then(release, release);
    }
    return pending;
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

    const settledContext = settleDeep(eventPayload.context);
    const rawContext = isThenable(settledContext) ? await settledContext : settledContext;
    if (findFailedArgument(rawContext)) {
      return;
    }
    const context =
      rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
        ? (rawContext as Record<string, unknown>)
        : {};

    let resolvedUserMessage = eventPayload.userMessage;
    if (resolvedUserMessage !== undefined) {
      const settledMsg = settleDeep(resolvedUserMessage);
      if (isThenable(settledMsg)) {
        resolvedUserMessage = await settledMsg;
        if (findFailedArgument(resolvedUserMessage)) {
          return;
        }
        if (typeof resolvedUserMessage !== 'string') {
          await this.dispatchError({
            code: 'INVALID_ACTION',
            surfaceId: this.id,
            message: "Action event 'userMessage' must resolve to a string.",
          });
          return;
        }
      } else if (findFailedArgument(settledMsg)) {
        return;
      } else {
        resolvedUserMessage = settledMsg;
      }
    }

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

    if (typeof resolvedUserMessage === 'string' && resolvedUserMessage.length > 0) {
      actionToDispatch.userMessage = resolvedUserMessage;
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
    this.isDisposed = true;
    this.agentFunctionCaller = undefined;
    this.inFlightAgentCalls.clear();
    this.settledAgentCalls.clear();
    this.dataModel.dispose();
    this.componentsModel.dispose();
    this._onAction.dispose();
    this._onError.dispose();
    this._onWarning.dispose();
  }
}

/** Maximum number of settled reactive agent call answers cached per surface. */
const MAX_AGENT_CALL_CACHE_ENTRIES = 256;

/**
 * Recursively sorts plain-object keys while preserving array element order so
 * structurally equivalent argument maps produce the same cache key.
 */
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
      }
      return sorted;
    }
  }
  return value;
}

/**
 * Builds the key that identifies identical agent function calls.
 *
 * @param call The agent function call.
 * @returns The key, or `undefined` if the arguments cannot be serialized, in
 *   which case the call is not shared.
 */
function agentCallKey(call: AgentFunctionCall): string | undefined {
  try {
    return JSON.stringify([call.catalogId, call['@call'], canonicalizeJson(call.args)]);
  } catch {
    return undefined;
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
