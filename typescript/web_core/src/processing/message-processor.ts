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

import {zodToJsonSchema} from 'zod-to-json-schema';
import {SurfaceModel, ActionListener} from '../state/surface-model.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {generateCatalogSchema, cleanSchemaNode} from '../catalog/schema_generator.js';
import {SurfaceGroupModel} from '../state/surface-group-model.js';
import {ComponentModel} from '../state/component-model.js';
import {SurfaceComponentsModel} from '../state/surface-components-model.js';
import {DataModel} from '../state/data-model.js';
import {Subscription} from '../common/events.js';

import {A2uiCatalogError, A2uiIntegrityError, A2uiValidationError} from '../errors.js';
import {defaultVersionAdapterFactory} from './adapters/factory.js';
import {compareSemVer, isAtLeastVersion, toCanonicalVersion} from '../common/semver.js';
import {
  InternalOperation,
  InternalCreateSurfaceOp,
  InternalUpdateComponentsOp,
  InternalUpdateDataModelOp,
  InternalDeleteSurfaceOp,
  isInternalOperation,
} from './operations.js';

import {
  isCatalogVersionCompatible,
  ProtocolVersion,
  VersionAdapterResolver,
} from './adapters/base.js';
import {RendererCapabilities} from '../v1_0/schema/index.js';
import type {ServerToClientMessage as V08ServerToClientMessage} from '../v0_8/types/types.js';
import type {
  A2uiMessage as V09A2uiMessage,
  A2uiMessageListWrapper as V09A2uiMessageListWrapper,
} from '../v0_9/schema/server-to-client.js';
import type {
  AgentToRendererMessage as V10AgentToRendererMessage,
  CallRendererFunctionMessage,
} from '../v1_0/schema/agent-to-renderer.js';
import type {RendererFunctionResponseMessage} from '../v1_0/schema/renderer-to-agent.js';
import type {FunctionCall} from '../v1_0/schema/common-types.js';
import {
  RpcHandler,
  CallOptions,
  OutboundMessageListener,
  A2uiRpcError,
  RpcErrorCode,
} from '../rpc/index.js';
import {DataContext} from '../resolution/data-context.js';
import {
  getComponentReferences,
  RELAXED_VALIDATION,
  STRICT_VALIDATION,
  validateRecursionAndPaths,
  ValidationConfig,
} from '../validation/integrity-checker.js';

/**
 * Union of individual message types supported by the MessageProcessor across protocol versions.
 */
export type ProcessableMessage =
  | V08ServerToClientMessage
  | V09A2uiMessage
  | V10AgentToRendererMessage
  | InternalOperation;

/**
 * Valid payload format for `MessageProcessor.processMessages`, which can be a single message,
 * an array of messages, a message list wrapper, or an internal operation.
 */
export type ProcessableMessagePayload =
  | ProcessableMessage
  | readonly ProcessableMessage[]
  | V09A2uiMessageListWrapper
  | {readonly messages: readonly ProcessableMessage[]};

export type {
  RendererCapabilities,
  RendererCapabilities as ClientCapabilities,
  ValidationConfig,
  OutboundMessageListener,
  CallOptions,
};
export {STRICT_VALIDATION, RELAXED_VALIDATION, A2uiRpcError, RpcErrorCode};

/**
 * Contextual execution options for message processing.
 */
export interface ExecutionContext {
  /** Whether execution occurs in an active user gesture context. */
  isUserActivated?: boolean;
}

/**
 * Options for generating renderer capabilities.
 */
export interface CapabilitiesOptions {
  /** Protocol versions to generate capabilities for. Required; must contain at least one version. */
  versions: ProtocolVersion[];
  /** Whether full definitions of all catalogs will be included inline. */
  includeInlineCatalogs?: boolean;
  /** Base schema `$ref` to wrap component definitions in inline catalogs. Defaults to 'common_types.json#/$defs/ComponentCommon'. */
  componentEnvelopeRef?: string;
}

/**
 * Options for configuring a MessageProcessor instance.
 */
export interface MessageProcessorOptions {
  /** Default protocol version to use for capability generation and data model reporting. Defaults to 'v0.9'. */
  version?: ProtocolVersion;
  /** Custom version adapter resolver or registry. Defaults to VersionAdapterFactory. */
  adapterRegistry?: VersionAdapterResolver;
  /** Validation configuration rules. */
  validationConfig?: ValidationConfig;
  /** Listener receiving outbound renderer messages intended for the agent. Required for callAgentFunction. */
  outboundListener?: OutboundMessageListener;
  /** Default timeout in milliseconds for callAgentFunction requests (default: 30000ms). */
  defaultTimeoutMs?: number;
}

import {formatZodIssue} from './format-zod-issue.js';
import {
  nestedCallRunsInCatalog,
  nonStringCatalogIdMessage,
  PayloadValidator,
} from '../validation/payload-validator.js';
export {formatZodIssue};

/**
 * Central processor for A2UI protocol messages and surface state management.
 *
 * @template T Concrete type of the ComponentApi.
 */
export class MessageProcessor<T extends ComponentApi = ComponentApi> {
  readonly model: SurfaceGroupModel<T>;
  readonly rpc: RpcHandler;
  private readonly adapterRegistry: VersionAdapterResolver;
  private readonly validationConfig?: ValidationConfig;

  /**
   * Initializes a new `MessageProcessor` instance.
   *
   * @param catalogs List of available component catalogs.
   * @param actionHandler Global handler for actions dispatched from all surfaces.
   * @param options Configuration options for the processor.
   */
  constructor(
    private catalogs: Catalog<any>[],
    private actionHandler?: ActionListener,
    options?: MessageProcessorOptions,
  ) {
    this.model = new SurfaceGroupModel<T>();
    this.adapterRegistry = options?.adapterRegistry ?? defaultVersionAdapterFactory;
    this.rpc = new RpcHandler({
      catalogs: this.catalogs,
      outboundListener: options?.outboundListener,
      defaultTimeoutMs: options?.defaultTimeoutMs,
    });
    if (options?.validationConfig) {
      this.validationConfig = {
        allowOrphanComponents: false,
        allowDanglingReferences: false,
        allowMissingRoot: false,
        allowUnknownElements: false,
        ...options.validationConfig,
      };
    } else {
      this.validationConfig = undefined;
    }
    if (this.actionHandler) {
      this.model.onAction.subscribe(this.actionHandler);
    }
  }

  /**
   * Invokes a remote function on the server agent using an options bag.
   *
   * @param surfaceId The ID of the surface requesting execution.
   * @param call The function call details.
   * @param options Optional invocation options (custom functionCallId, timeoutMs).
   * @returns A promise resolving to the agent function return value.
   */
  callAgentFunction<TRes = unknown>(
    surfaceId: string,
    call: FunctionCall,
    options?: CallOptions,
  ): Promise<TRes> {
    return this.rpc.callAgentFunction<TRes>(surfaceId, call, options);
  }

  /**
   * Disposes the MessageProcessor, tearing down active surfaces and rejecting pending RPC calls.
   */
  dispose(): void {
    this.rpc.dispose();
  }

  /**
   * Generates the renderer capabilities object for the current processor.
   *
   * @param options Configuration for capability generation.
   * @returns The capabilities object.
   */
  getRendererCapabilities(options: CapabilitiesOptions): RendererCapabilities {
    if (!options?.versions || options.versions.length === 0) {
      throw new A2uiValidationError(
        'At least one protocol version must be provided in CapabilitiesOptions to generate renderer capabilities.',
      );
    }
    const versions = options.versions;
    const result: Record<string, any> = {};

    for (const ver of versions) {
      const versionCaps: Record<string, any> = {
        supportedCatalogIds: this.catalogs.map(c => c.id),
      };

      const inlineCatalogs = options?.includeInlineCatalogs
        ? this.catalogs.map(c => {
            if (compareSemVer(ver, '1.0') >= 0) {
              return generateCatalogSchema(c, {
                componentEnvelopeRef: options?.componentEnvelopeRef,
                protocolVersion: ver,
              });
            }
            return this.generateLegacyInlineCatalog(
              c,
              options?.componentEnvelopeRef ?? 'common_types.json#/$defs/ComponentCommon',
            );
          })
        : undefined;

      if (inlineCatalogs) {
        versionCaps.inlineCatalogs = inlineCatalogs;
      }

      result[ver] = versionCaps;
    }

    return result as RendererCapabilities;
  }

  /**
   * Generates the client/renderer capabilities object for the current processor.
   *
   * @deprecated Use `getRendererCapabilities` instead.
   * @param options Configuration for capability generation.
   * @returns The capabilities object.
   */
  getClientCapabilities(options: CapabilitiesOptions): RendererCapabilities {
    return this.getRendererCapabilities(options);
  }

  /**
   * Generates a backwards-compatible inline catalog representation for v0.8/v0.9/v0.9.1.
   *
   * @param catalog The catalog instance to serialize.
   * @param componentEnvelopeRef Reference URI for the component base envelope.
   * @returns Legacy inline catalog object with array-based functions and flat theme properties.
   */
  private generateLegacyInlineCatalog(
    catalog: Catalog<T>,
    componentEnvelopeRef = 'common_types.json#/$defs/ComponentCommon',
  ): Record<string, unknown> {
    const components: Record<string, unknown> = {};
    for (const [name, comp] of catalog.components.entries()) {
      let props: Record<string, unknown> = {};
      let reqList: string[] = [];
      if (comp.schema && typeof comp.schema === 'object' && 'safeParse' in comp.schema) {
        const rawZod = zodToJsonSchema(comp.schema, {
          target: 'jsonSchema2019-09',
          $refStrategy: 'none',
        }) as Record<string, unknown>;
        cleanSchemaNode(rawZod, undefined, {stripAdditionalProperties: true});
        props = (rawZod.properties as Record<string, unknown>) || {};
        reqList = Array.isArray(rawZod.required)
          ? (rawZod.required as string[]).filter(r => r !== 'component' && r !== 'id')
          : [];
      }
      const {component: _ignoredComp, id: _ignoredId, ...sanitizedProps} = props;
      components[name] = {
        allOf: [
          {$ref: componentEnvelopeRef},
          {
            properties: {
              component: {const: name},
              ...sanitizedProps,
            },
            required: ['component', ...reqList],
          },
        ],
      };
    }

    const functions: Array<Record<string, unknown>> = [];
    for (const fn of catalog.functions.values()) {
      let paramSchema: Record<string, unknown> = {type: 'object', properties: {}};
      if (fn.schema && typeof fn.schema === 'object' && 'safeParse' in fn.schema) {
        const rawZod = zodToJsonSchema(fn.schema, {
          target: 'jsonSchema2019-09',
          $refStrategy: 'none',
        }) as Record<string, unknown>;
        cleanSchemaNode(rawZod, undefined, {stripAdditionalProperties: true});
        paramSchema = rawZod;
      }
      functions.push({
        name: fn.name,
        ...(fn.description ? {description: fn.description} : {}),
        returnType: fn.returnType,
        parameters: paramSchema,
      });
    }

    let theme: Record<string, unknown> | undefined;
    if (catalog.themeSchema) {
      const rawTheme = zodToJsonSchema(catalog.themeSchema, {
        target: 'jsonSchema2019-09',
        $refStrategy: 'none',
      }) as Record<string, unknown>;
      cleanSchemaNode(rawTheme, undefined, {stripAdditionalProperties: true});
      theme = (rawTheme.properties as Record<string, unknown>) || undefined;
    }

    return {
      catalogId: catalog.id,
      ...(Object.keys(components).length > 0 ? {components} : {}),
      ...(functions.length > 0 ? {functions} : {}),
      ...(theme ? {theme} : {}),
    };
  }

  /**
   * Serializes active surface data models configured for client-to-agent reporting.
   *
   * If version is provided, returns data models only for surfaces compatible with that version.
   * If version is omitted:
   *   - Automatically derives the protocol version from the active surface(s) with sendDataModel.
   *   - If active surfaces have conflicting protocol versions, throws A2uiValidationError.
   *
   * @param version Optional target protocol version to filter surfaces.
   * @returns Serialized data model payload, or undefined if no matching surfaces exist.
   */
  getRendererDataModel(version?: ProtocolVersion): Record<string, unknown> | undefined {
    const enabledSurfaces = Array.from(this.model.surfacesMap.values()).filter(
      s => s.sendDataModel,
    );
    if (enabledSurfaces.length === 0) {
      return undefined;
    }

    if (version !== undefined) {
      const surfaces: Record<string, unknown> = {};
      for (const surface of enabledSurfaces) {
        const catVer = surface.protocolVersion;
        if (!catVer || isCatalogVersionCompatible(catVer, version)) {
          surfaces[surface.id] = surface.dataModel.get('/');
        }
      }
      if (Object.keys(surfaces).length === 0) {
        return undefined;
      }
      return {
        version,
        surfaces,
      };
    }

    const versionsSet = new Set<ProtocolVersion>();
    for (const surface of enabledSurfaces) {
      if (surface.protocolVersion) {
        const canonical = toCanonicalVersion(surface.protocolVersion);
        const canonicalVer = (
          canonical ? `v${canonical}` : surface.protocolVersion
        ) as ProtocolVersion;
        versionsSet.add(canonicalVer);
      }
    }

    if (versionsSet.size > 1) {
      throw new A2uiValidationError(
        `Multiple protocol versions detected among active surfaces: ${Array.from(versionsSet).sort().join(', ')}. ` +
          'Specify a target protocol version in getRendererDataModel(version).',
      );
    }

    const verStr =
      versionsSet.size === 1 ? (versionsSet.values().next().value as ProtocolVersion) : 'v1.0';
    const surfaces: Record<string, unknown> = {};
    for (const surface of enabledSurfaces) {
      surfaces[surface.id] = surface.dataModel.get('/');
    }
    return {
      version: verStr,
      surfaces,
    };
  }

  /**
   * Aggregates active client/renderer data models.
   *
   * @deprecated Use `getRendererDataModel` instead.
   * @param version Optional target protocol version to format data models for.
   * @returns Serialized data model payload, or undefined if no matching surfaces exist.
   */
  getClientDataModel(version?: ProtocolVersion): Record<string, unknown> | undefined {
    return this.getRendererDataModel(version);
  }

  /**
   * Resolves a relative path against a context path.
   *
   * @deprecated Use `DataModel.resolvePath` instead.
   * @param path The path to resolve.
   * @param contextPath The base path (optional).
   * @returns The resolved absolute path.
   */
  resolvePath(path: string, contextPath?: string): string {
    return DataModel.resolvePath(path, contextPath);
  }

  /**
   * Gets a read-only map of active surfaces managed by this processor.
   *
   * @returns Map of surface models keyed by surface identifier.
   */
  getSurfaces(): ReadonlyMap<string, SurfaceModel<T>> {
    return this.model.surfacesMap;
  }

  /**
   * Retrieves an active surface by its ID.
   *
   * @param id The surface ID.
   * @returns The matching surface model, or undefined if not found.
   */
  getSurface(id: string): SurfaceModel<T> | undefined {
    return this.model.getSurface(id);
  }

  /**
   * Subscribes to surface creation events.
   *
   * @param handler Callback invoked when a surface is created.
   * @returns A subscription object to unsubscribe.
   */
  onSurfaceCreated(handler: (surface: SurfaceModel<T>) => void): Subscription {
    return this.model.onSurfaceCreated.subscribe(handler);
  }

  /**
   * Subscribes to surface deletion events.
   *
   * @param handler Callback invoked when a surface is deleted.
   * @returns A subscription object to unsubscribe.
   */
  onSurfaceDeleted(handler: (id: string) => void): Subscription {
    return this.model.onSurfaceDeleted.subscribe(handler);
  }

  /**
   * Processes a list of messages, a message wrapper, or raw operations synchronously.
   *
   * @param messages The messages or operations to process.
   * @param context Contextual execution options.
   */
  processMessages(messages: ProcessableMessagePayload, context?: ExecutionContext): void {
    const operations = this.prepareOperations(messages);
    for (const op of operations) {
      this.processOperation(op, context);
    }
  }

  /**
   * Asynchronously processes messages, executing RPC calls and returning all produced responses.
   *
   * @param messages The messages or operations to process.
   * @param context Contextual execution options.
   * @returns Array of rendererFunctionResponse messages produced during execution.
   */
  async processMessagesAsync(
    messages: ProcessableMessagePayload,
    context?: ExecutionContext,
  ): Promise<RendererFunctionResponseMessage[]> {
    const operations = this.prepareOperations(messages);
    const responses: RendererFunctionResponseMessage[] = [];
    for (const op of operations) {
      const resp = await this.processOperationAsync(op, context);
      if (resp) {
        responses.push(resp);
      }
    }
    return responses;
  }

  private prepareOperations(messages: ProcessableMessagePayload): InternalOperation[] {
    if (!messages || (Array.isArray(messages) && messages.length === 0)) return [];

    if (this.validationConfig) {
      validateRecursionAndPaths(messages);
    }

    if (this.validationConfig?.targetVersion) {
      this.validateTargetVersion(messages);
    }

    if (isInternalOperation(messages)) {
      return [messages];
    }

    const adapter = this.adapterRegistry.resolveFromPayload(messages);
    return adapter.extractOperations(messages);
  }

  private validateTargetVersion(messages: ProcessableMessagePayload): void {
    const expected = this.validationConfig?.targetVersion;
    if (!expected) return;

    const checkMsg = (msg: unknown) => {
      if (typeof msg === 'object' && msg !== null && 'version' in msg) {
        const msgVer = (msg as {version?: string}).version;
        if (msgVer) {
          const normMsg = toCanonicalVersion(msgVer) ?? msgVer;
          const normExpected = toCanonicalVersion(expected) ?? expected;
          if (normMsg !== normExpected) {
            throw new A2uiValidationError(
              `Message version '${msgVer}' does not match expected target version '${expected}'`,
            );
          }
        }
      }
    };

    if (Array.isArray(messages)) {
      for (const m of messages) {
        checkMsg(m);
      }
    } else {
      checkMsg(messages);
    }
  }

  private applyStateOperation(op: InternalOperation): void {
    if (
      this.validationConfig?.allowedMessages &&
      !this.validationConfig.allowedMessages.includes(op.type)
    ) {
      throw new A2uiValidationError(
        `Operation '${op.type}' is not permitted by ValidationConfig.allowedMessages`,
      );
    }

    switch (op.type) {
      case 'createSurface':
        this.processCreateSurfaceOp(op);
        break;
      case 'deleteSurface':
        this.processDeleteSurfaceOp(op);
        break;
      case 'updateComponents':
        this.processUpdateComponentsOp(op);
        break;
      case 'updateDataModel':
        this.processUpdateDataModelOp(op);
        break;
      case 'agentFunctionResponse':
        this.rpc.handleAgentFunctionResponse({
          version: (op.version ?? 'v1.0') as 'v1.0',
          agentFunctionResponse: {
            functionCallId: op.functionCallId,
            value: op.value,
            error: op.error,
          },
        });
        break;
      case 'callRendererFunction':
        break;
    }
  }

  /**
   * Resolves the DataContext for an inbound RPC callRendererFunction operation.
   *
   * @param op Operation containing optional catalog and function call identifiers.
   * @returns A DataContext attached to an existing matching surface or a fallback surface.
   */
  private resolveRpcDataContext(op: {catalogId?: string; functionCallId?: string}): DataContext {
    const targetCatalog =
      (op.catalogId ? this.catalogs.find(c => c.id === op.catalogId) : undefined) ??
      this.catalogs[0];
    const surface =
      (op.catalogId
        ? Array.from(this.model.surfacesMap.values()).find(
            s => s.defaultCatalog?.id === op.catalogId || s.availableCatalogs?.has(op.catalogId!),
          )
        : undefined) ?? this.model.surfacesMap.values().next().value;
    if (surface) {
      return new DataContext(surface, '/');
    }
    const fallbackSurfaceId = `_rpc_fallback_${op.functionCallId || 'default'}`;
    const availableCatalogs = new Map<string, Catalog<T>>();
    for (const cat of this.catalogs) {
      if (
        targetCatalog?.protocolVersion &&
        cat.protocolVersion &&
        isCatalogVersionCompatible(targetCatalog.protocolVersion, cat.protocolVersion)
      ) {
        availableCatalogs.set(cat.id, cat);
      }
    }
    if (targetCatalog) {
      availableCatalogs.set(targetCatalog.id, targetCatalog);
    }
    return new DataContext(
      new SurfaceModel(fallbackSurfaceId, targetCatalog, availableCatalogs),
      '/',
    );
  }

  /**
   * Processes a single canonical internal operation.
   *
   * @param op The internal operation to execute.
   * @param context Contextual execution options.
   */
  processOperation(op: InternalOperation, context?: ExecutionContext): void {
    if (op.type === 'callRendererFunction') {
      const dataContext = this.resolveRpcDataContext(op);
      const isUserActivated = context?.isUserActivated ?? op.isUserActivated ?? false;
      const callMsg: CallRendererFunctionMessage = {
        version: (op.version ?? 'v1.0') as 'v1.0',
        callRendererFunction: {
          functionCallId: op.functionCallId,
          callFunction: {
            call: op.call,
            catalogId: op.catalogId,
            args: op.args,
          },
        },
      };
      void this.rpc.handleCallRendererFunction(callMsg, dataContext, isUserActivated).catch(err => {
        console.error(`Unhandled error in callRendererFunction (${op.call}):`, err);
      });
      return;
    }

    this.applyStateOperation(op);
  }

  private async processOperationAsync(
    op: InternalOperation,
    context?: ExecutionContext,
  ): Promise<RendererFunctionResponseMessage | null> {
    if (op.type === 'callRendererFunction') {
      const dataContext = this.resolveRpcDataContext(op);
      const isUserActivated = context?.isUserActivated ?? op.isUserActivated ?? false;
      const callMsg: CallRendererFunctionMessage = {
        version: (op.version ?? 'v1.0') as 'v1.0',
        callRendererFunction: {
          functionCallId: op.functionCallId,
          callFunction: {
            call: op.call,
            catalogId: op.catalogId,
            args: op.args,
          },
        },
      };
      return await this.rpc.handleCallRendererFunction(callMsg, dataContext, isUserActivated);
    }

    this.applyStateOperation(op);
    return null;
  }

  private processCreateSurfaceOp(op: InternalCreateSurfaceOp): void {
    const {surfaceId, catalogId, theme, sendDataModel, components, dataModel} = op;

    const msgVersion = op.version;
    // From v1.0 the default catalog is optional: a surface that names none has
    // none, and every component and function call on it names its own.
    const noDefaultCatalog =
      catalogId === undefined && msgVersion !== undefined && isAtLeastVersion(msgVersion, '1.0');
    const catalog = noDefaultCatalog
      ? undefined
      : resolveSurfaceDefaultCatalog(this.catalogs, catalogId, msgVersion);
    if (!catalog && !noDefaultCatalog) {
      if (catalogId !== undefined) {
        throw new A2uiCatalogError(`Catalog not found: ${catalogId}`);
      }
      throw new A2uiCatalogError(`No default catalog available for surface '${surfaceId}'.`);
    }

    if (
      catalog?.protocolVersion &&
      msgVersion &&
      !isCatalogVersionCompatible(catalog.protocolVersion, msgVersion)
    ) {
      throw new A2uiValidationError(
        `Surface '${surfaceId}' catalog '${catalogId ?? catalog.id}' specification version (${catalog.protocolVersion}) does not match message protocol version (${msgVersion}).`,
      );
    }

    if (this.model.getSurface(surfaceId)) {
      throw new A2uiIntegrityError(`Surface ${surfaceId} already exists.`);
    }

    let validatedTheme = theme;
    if (theme && catalog?.themeSchema) {
      try {
        validatedTheme = new PayloadValidator(catalog, this.validationConfig).validateTheme(theme);
      } catch (err: unknown) {
        if (err instanceof A2uiValidationError) {
          throw new A2uiValidationError(
            err.message.replace(
              /^Validation failed for theme:/,
              `Validation failed for theme on surface '${surfaceId}':`,
            ),
            err.details,
          );
        }
        throw err;
      }
    }

    const surfaceVersion = catalog?.protocolVersion ?? msgVersion;

    // A payload may address any registered catalog by `catalogId`, but only
    // those speaking a compatible protocol version can be resolved against this
    // surface, so filter once here rather than at every lookup.
    const availableCatalogs = new Map<string, Catalog<T>>(
      this.catalogs
        .filter(c => isCatalogVersionCompatible(c.protocolVersion, surfaceVersion))
        .map(c => [c.id, c] as const),
    );

    const surface = new SurfaceModel<T>(
      surfaceId,
      catalog,
      availableCatalogs,
      validatedTheme,
      sendDataModel ?? false,
      undefined,
      op.rootId ?? 'root',
      op.metadata,
      surfaceVersion,
    );
    this.model.addSurface(surface);

    if (dataModel) {
      // Assign the whole object at the root rather than building a pointer per
      // key. Key names are literal property names, so a key containing '/' or
      // '~' would otherwise be misread as a nested path.
      surface.dataModel.set('/', dataModel);
    }

    if (components && components.length > 0) {
      this.processUpdateComponentsOp({
        type: 'updateComponents',
        surfaceId,
        components,
      });
    }
  }

  private processDeleteSurfaceOp(op: InternalDeleteSurfaceOp): void {
    if (!op.surfaceId) return;
    this.model.deleteSurface(op.surfaceId);
  }

  private validateComponentProperties(
    comp: Record<string, unknown>,
    surface: SurfaceModel<T>,
  ): void {
    const {id, component} = comp;

    if (typeof id !== 'string' || !id) {
      throw new A2uiValidationError(
        `Component '${component}' is missing an 'id'; entries require a valid string 'id'.`,
      );
    }

    const targetCatalog = this.resolveComponentCatalog(comp, surface);

    // A partial update names no component type; the existing model supplies it.
    const existing = surface.componentsModel.get(id);
    new PayloadValidator(targetCatalog, this.validationConfig).validateComponent(
      this.componentPayloadForValidation(comp, surface, targetCatalog),
      existing?.type,
    );
    // `validateComponent` walks nested calls only when the catalog defines the
    // component type; otherwise every call is checked against its resolved
    // catalog below.
    const declaredType = typeof component === 'string' ? component : existing?.type;
    const nestedCallsWalked = !!declaredType && targetCatalog.components.has(declaredType);
    this.validateNestedFunctionCalls(comp, surface, targetCatalog, nestedCallsWalked);
  }

  /**
   * Builds the component payload handed to `PayloadValidator`, telling it
   * which catalog the component is in.
   *
   * From v1.0 a function call that names no `catalogId` runs in the surface
   * default catalog. The validator takes a component that names no
   * `catalogId` to be in the surface default, so the payload names the
   * component's catalog only when that catalog is another one; the validator
   * then leaves those calls to `validateNestedFunctionCalls`, which checks
   * them against the surface default. Whether the payload itself wrote a
   * `catalogId` doesn't matter: a component naming the surface default is in
   * it all the same.
   *
   * @param comp Raw component payload.
   * @param surface Surface the component belongs to.
   * @param componentCatalog Catalog the component resolved to.
   * @returns The payload to validate.
   */
  private componentPayloadForValidation(
    comp: Record<string, unknown>,
    surface: SurfaceModel<T>,
    componentCatalog: Catalog<T>,
  ): Record<string, unknown> {
    const {catalogId: _catalogId, ...payload} = comp;
    if (
      isAtLeastVersion(surface.protocolVersion, '1.0') &&
      componentCatalog !== surface.defaultCatalog
    ) {
      payload['catalogId'] = componentCatalog.id;
    }
    return payload;
  }

  /**
   * Resolves the catalog that defines a component in an update.
   *
   * The component uses the catalog it names, and otherwise the surface's
   * default catalog. Below v1.0 only, an existing component updated without a
   * new type keeps its catalog; from v1.0 every update is a full replacement
   * and resolves afresh.
   *
   * @param comp Raw component payload.
   * @param surface Surface the component belongs to.
   * @returns The catalog that defines the component.
   * @throws {A2uiCatalogError} If the named catalog is unknown or speaks an
   *   incompatible protocol version, or if the component names no catalog and
   *   the surface has no default catalog.
   */
  private resolveComponentCatalog(
    comp: Record<string, unknown>,
    surface: SurfaceModel<T>,
  ): Catalog<T> {
    const {id, component, catalogId} = comp;
    const subject = `Component '${id}'`;
    const atLeastV1 = isAtLeastVersion(surface.protocolVersion, '1.0');
    // From v1.0 an empty catalogId names a catalog too (one that never exists).
    if (typeof catalogId === 'string' && (catalogId || atLeastV1)) {
      return this.resolveSurfaceItemCatalog(surface, catalogId, subject);
    }

    if (!atLeastV1) {
      const existing = typeof id === 'string' ? surface.componentsModel.get(id) : undefined;
      if (
        existing &&
        (typeof component !== 'string' || !component || component === existing.type)
      ) {
        return existing.catalog as Catalog<T>;
      }
    }
    return this.resolveSurfaceItemCatalog(surface, undefined, subject);
  }

  /**
   * Validates each v1.0 function call nested in a component against the
   * catalog it resolves to on the surface.
   *
   * Each call resolves on its own, by the `catalogId` it names or else to
   * the surface's default catalog, whatever catalog an enclosing call or the
   * component names, so a call may run in a catalog other than the
   * component's. This pass resolves every call's catalog and checks the
   * arguments of the calls that run outside the component's catalog; when
   * component validation walked the nested calls, it already checked the
   * others, as decided by `nestedCallRunsInCatalog`.
   * Reserved `@` system functions belong to no catalog and are validated by
   * `PayloadValidator`; their arguments are still walked here.
   *
   * Catalog resolution runs even without a `validationConfig`, so a call no
   * catalog on the surface can run is always rejected before state changes.
   *
   * @param comp Raw component payload.
   * @param surface Surface the component belongs to.
   * @param componentCatalog Catalog the component resolved to.
   * @param nestedCallsWalked Whether component validation walked the nested
   *   calls, checking those that run in `componentCatalog`.
   * @throws {A2uiCatalogError} If a call's catalog cannot be resolved.
   * @throws {A2uiValidationError} If a call fails validation against the
   *   catalog it resolves to.
   */
  private validateNestedFunctionCalls(
    comp: Record<string, unknown>,
    surface: SurfaceModel<T>,
    componentCatalog: Catalog<T>,
    nestedCallsWalked: boolean,
  ): void {
    if (!isAtLeastVersion(surface.protocolVersion, '1.0')) return;

    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== 'object' || node === null) return;

      const record = node as Record<string, unknown>;
      const name = record['@call'];
      if (typeof name === 'string' && name && !name.startsWith('@')) {
        // Any string, the empty string included, names a catalog, exactly as
        // `DataContext` resolves the call at runtime.
        const rawCatalogId = record['catalogId'];
        if (rawCatalogId !== undefined && typeof rawCatalogId !== 'string') {
          // Only reached when component validation did not walk the nested
          // calls; when it does, it throws this same error before this pass.
          throw new A2uiValidationError(nonStringCatalogIdMessage(name));
        }
        const catalogId = rawCatalogId;
        const target = this.resolveSurfaceItemCatalog(
          surface,
          catalogId,
          `Function call '${name}'`,
        );
        // Component validation already checked a call that runs in the
        // component's catalog.
        const checked =
          nestedCallsWalked &&
          nestedCallRunsInCatalog(catalogId, componentCatalog.id, {
            catalogIsDefault: componentCatalog === surface.defaultCatalog,
          });
        if (!checked) {
          const rawArgs = record['args'];
          new PayloadValidator(target, this.validationConfig).validateFunction(
            name,
            (rawArgs ?? {}) as Record<string, unknown>,
          );
        }
      }
      Object.values(record).forEach(visit);
    };

    for (const [key, value] of Object.entries(comp)) {
      if (key === 'id' || key === 'component' || key === 'catalogId' || key === 'metadata') {
        continue;
      }
      visit(value);
    }
  }

  /**
   * Resolves the catalog an item on a surface uses: the catalog it names, or
   * else the surface's default catalog.
   *
   * Delegates to `SurfaceModel.resolveCatalog`, which `DataContext` also uses
   * at runtime, so validation and execution share one rule and one set of
   * error messages. It first reports a catalog the processor knows yet the
   * surface cannot use because its protocol version differs.
   *
   * @param surface Surface the item belongs to.
   * @param catalogId Catalog the item names, if any.
   * @param subject Description of the item for error messages.
   * @returns The catalog the item resolves to.
   * @throws {A2uiCatalogError} If the item's catalog cannot be resolved.
   */
  private resolveSurfaceItemCatalog(
    surface: SurfaceModel<T>,
    catalogId: string | undefined,
    subject: string,
  ): Catalog<T> {
    if (catalogId !== undefined && !surface.availableCatalogs.has(catalogId)) {
      const known = this.catalogs.find(c => c.id === catalogId);
      if (known) {
        throw new A2uiCatalogError(
          `${subject} names catalog '${catalogId}', whose specification version (${known.protocolVersion}) does not match surface '${surface.id}' version (${surface.protocolVersion}).`,
        );
      }
    }
    return surface.resolveCatalog(catalogId, subject);
  }

  private applyComponentUpdate(comp: Record<string, unknown>, surface: SurfaceModel<T>): void {
    const {id, component, catalogId: _catalogId, metadata: rawMetadata, ...properties} = comp;
    if (typeof id !== 'string') return;
    const metadata = extractComponentMetadata(rawMetadata);
    const targetCatalog = this.resolveComponentCatalog(comp, surface);
    const existing = surface.componentsModel.get(id);

    if (existing) {
      const componentType = typeof component === 'string' ? component : existing.type;
      if (componentType !== existing.type || existing.catalog.id !== targetCatalog.id) {
        // Recreate the component if its type or catalog changes. From v1.0 an
        // update naming no catalogId can move it to the surface default.
        surface.componentsModel.removeComponent(id);
        const newComponent = new ComponentModel(
          id,
          componentType,
          properties,
          targetCatalog,
          metadata,
        );
        surface.componentsModel.addComponent(newComponent);
      } else {
        existing.metadata = metadata;
        existing.properties = properties;
      }
    } else {
      if (typeof component !== 'string' || !component) {
        throw new A2uiValidationError(`Cannot create component ${id} without a type.`);
      }
      const newComponent = new ComponentModel(id, component, properties, targetCatalog, metadata);
      surface.componentsModel.addComponent(newComponent);
    }
  }

  private processUpdateComponentsOp(op: InternalUpdateComponentsOp): void {
    if (!op.surfaceId) return;

    const surface = this.model.getSurface(op.surfaceId);
    if (!surface) {
      throw new A2uiIntegrityError(`Surface not found for message: ${op.surfaceId}`);
    }

    // 1. Validation pass: validate all components before mutating state
    const seenBatchIds = new Set<string>();
    for (const comp of op.components) {
      if (comp && typeof comp === 'object' && typeof comp.id === 'string') {
        if (seenBatchIds.has(comp.id)) {
          throw new A2uiIntegrityError(`Duplicate component ID: '${comp.id}'`, [comp.id]);
        }
        seenBatchIds.add(comp.id);
      }
      this.validateComponentProperties(comp, surface);
    }

    this.validateCompositionConstraints(surface, op.components);
    this.validateCandidateTopology(surface, op.components);

    // 2. Mutation pass: apply state updates
    for (const comp of op.components) {
      this.applyComponentUpdate(comp, surface);
    }
  }

  private processUpdateDataModelOp(op: InternalUpdateDataModelOp): void {
    if (!op.surfaceId) return;

    const surface = this.model.getSurface(op.surfaceId);
    if (!surface) {
      throw new A2uiIntegrityError(`Surface not found for message: ${op.surfaceId}`);
    }

    const path = op.path || '/';
    const value = op.value;
    surface.dataModel.set(path, value);
  }

  private validateParentConstraints(
    id: string,
    componentType: string,
    allowedParents: string[],
    parents?: Array<{parentId: string; parentType: string}>,
  ): void {
    if (!parents || parents.length === 0) {
      const isRoot = id === 'root';
      const enforceTopLevel =
        isRoot || (this.validationConfig && this.validationConfig.allowOrphanComponents === false);
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

  private validateChildConstraints(
    id: string,
    componentType: string,
    allowedChildren: string[],
    children: string[],
    typeMap: Map<string, string>,
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

  private buildCompositionTopology(
    surface: SurfaceModel<T>,
    newComponents: Array<Record<string, unknown>>,
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

      const compCatalog = this.resolveComponentCatalog(comp, surface);
      compCatalogMap.set(id, compCatalog);
      const existing = surface.componentsModel.get(id);
      const compType = (typeof component === 'string' ? component : existing?.type) ?? '';
      if (compType) {
        typeMap.set(id, compType);
      }
      const compDef = {id, component: compType, ...props};
      const children = Array.from(getComponentReferences(compDef, compCatalog as Catalog<any>)).map(
        ([childId]) => childId,
      );
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

  private validateCompositionConstraints(
    surface: SurfaceModel<T>,
    newComponents: Array<Record<string, unknown>>,
  ): void {
    const {typeMap, compCatalogMap, childMap, parentMap} = this.buildCompositionTopology(
      surface,
      newComponents,
    );

    for (const [id, componentType] of typeMap.entries()) {
      const compCatalog = compCatalogMap.get(id);
      const componentApi = compCatalog?.components.get(componentType);
      if (!componentApi) continue;

      if (componentApi.allowedParents && componentApi.allowedParents.length > 0) {
        this.validateParentConstraints(
          id,
          componentType,
          componentApi.allowedParents,
          parentMap.get(id),
        );
      }

      if (componentApi.allowedChildren && componentApi.allowedChildren.length > 0) {
        this.validateChildConstraints(
          id,
          componentType,
          componentApi.allowedChildren,
          childMap.get(id) || [],
          typeMap,
        );
      }
    }
  }

  private validateCandidateTopology(
    surface: SurfaceModel<T>,
    newComponents: Array<Record<string, unknown>>,
  ): void {
    if (!this.validationConfig) return;

    const candidateModel = new SurfaceComponentsModel(surface.defaultCatalog);
    for (const [id, comp] of surface.componentsModel.entries) {
      candidateModel.addComponent(
        new ComponentModel(id, comp.type, comp.properties, comp.catalog as Catalog<T>),
      );
    }

    for (const comp of newComponents) {
      const {id, component, ...properties} = comp;
      if (typeof id !== 'string' || !id) continue;

      const targetCatalog = this.resolveComponentCatalog(comp, surface);
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
        candidateModel.addComponent(
          new ComponentModel(id, componentType, properties, targetCatalog),
        );
      }
    }

    candidateModel.validateTopology({
      ...this.validationConfig,
      rootId: this.validationConfig.rootId ?? surface.rootId,
    });
  }
}

function extractComponentMetadata(rawMetadata: unknown): Record<string, unknown> | undefined {
  if (rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)) {
    return rawMetadata as Record<string, unknown>;
  }
  return undefined;
}

function resolveSurfaceDefaultCatalog<T extends ComponentApi>(
  catalogs: ReadonlyArray<Catalog<T>>,
  catalogId: string | undefined,
  msgVersion: string | undefined,
): Catalog<T> | undefined {
  if (catalogId !== undefined) {
    return catalogs.find(c => c.id === catalogId);
  }
  return (
    catalogs.find(c =>
      msgVersion ? isCatalogVersionCompatible(c.protocolVersion, msgVersion) : true,
    ) ?? catalogs[0]
  );
}
