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

import {SurfaceModel, ActionListener} from '../state/surface-model.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {generateCatalogSchema} from '../catalog/schema_generator.js';
import {SurfaceGroupModel} from '../state/surface-group-model.js';
import {ComponentModel} from '../state/component-model.js';
import {SurfaceComponentsModel} from '../state/surface-components-model.js';
import {Subscription} from '../common/events.js';
import {z} from 'zod';

import {A2uiStateError, A2uiValidationError} from '../errors.js';
import {defaultVersionAdapterFactory} from './adapters/factory.js';
import {
  InternalOperation,
  InternalCreateSurfaceOp,
  InternalUpdateComponentsOp,
  InternalUpdateDataModelOp,
  InternalDeleteSurfaceOp,
} from './operations.js';

import {ProtocolVersion, VersionAdapterResolver} from './adapters/base.js';
import {RendererCapabilities} from '../v1_0/schema/index.js';
import type {ServerToClientMessage as V08ServerToClientMessage} from '../v0_8/types/types.js';
import type {
  A2uiMessage as V09A2uiMessage,
  A2uiMessageListWrapper as V09A2uiMessageListWrapper,
} from '../v0_9/schema/server-to-client.js';
import type {AgentToRendererMessage as V10AgentToRendererMessage} from '../v1_0/schema/agent-to-renderer.js';
import {
  getComponentReferences,
  RELAXED_VALIDATION,
  STRICT_VALIDATION,
  validateRecursionAndPaths,
  ValidationConfig,
} from '../validating/integrity-checker.js';

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

export type {RendererCapabilities, ValidationConfig};
export {STRICT_VALIDATION, RELAXED_VALIDATION};

/**
 * Options for generating renderer capabilities.
 */
export interface CapabilitiesOptions {
  /** Whether full definitions of all catalogs will be included inline. */
  includeInlineCatalogs?: boolean;
  /** Protocol version to generate capabilities for. Defaults to the processor's configured version. */
  version?: ProtocolVersion;
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
}

/**
 * Formats a Zod validation issue into a descriptive, human-readable string.
 *
 * Direct attribute extraction is used so that issue details (such as unrecognized
 * property keys or invalid enum options) are preserved even when running in
 * optimized/minified production builds where Zod's internal error map messages
 * may degrade into generic strings (e.g. "Expected undefined, received undefined").
 */
interface ZodIssueWithKeys {
  keys?: string[];
}

interface ZodIssueWithOptions {
  options?: string[];
  received?: unknown;
}

interface ZodIssueWithExpectedReceived {
  expected?: unknown;
  received?: unknown;
}

/**
 * Formats a Zod validation issue into a descriptive, human-readable error string.
 *
 * @param err Zod validation issue to format.
 * @returns Human-readable formatted error message.
 */
export function formatZodIssue(err: z.ZodIssue): string {
  const path = err.path.join('.') || 'root';
  const issueWithKeys = err as ZodIssueWithKeys;
  const issueWithOptions = err as ZodIssueWithOptions;
  const issueWithExpected = err as ZodIssueWithExpectedReceived;

  // 1. Unrecognized keys on .strict() schemas
  if ('keys' in err && Array.isArray(issueWithKeys.keys) && issueWithKeys.keys.length > 0) {
    const keysStr = issueWithKeys.keys.map((k: string) => `'${k}'`).join(', ');
    return `${path}: Unrecognized key(s) in object: ${keysStr}`;
  }

  // 2. Invalid enum values
  if (err.code === 'invalid_enum_value' && Array.isArray(issueWithOptions.options)) {
    const optionsStr = issueWithOptions.options.join(' | ');
    return `${path}: Invalid enum value. Expected ${optionsStr}, received '${String(issueWithOptions.received)}'`;
  }

  // 3. Fallback when message is corrupted into "Expected undefined, received undefined"
  if (err.message && !err.message.includes('Expected undefined, received undefined')) {
    return `${path}: ${err.message}`;
  }

  if (
    'expected' in err &&
    issueWithExpected.expected !== undefined &&
    issueWithExpected.received !== undefined
  ) {
    return (
      path +
      ': Expected ' +
      String(issueWithExpected.expected) +
      ', received ' +
      String(issueWithExpected.received)
    );
  }

  return `${path}: Validation error (${err.code || 'invalid'})`;
}

/**
 * Central processor for A2UI protocol messages and surface state management.
 *
 * @template T Concrete type of the ComponentApi.
 */
export class MessageProcessor<T extends ComponentApi = ComponentApi> {
  readonly model: SurfaceGroupModel<T>;
  readonly version: ProtocolVersion;
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
    this.version = options?.version ?? 'v0.9';
    this.adapterRegistry = options?.adapterRegistry ?? defaultVersionAdapterFactory;
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
   * Generates the renderer capabilities object for the current processor.
   *
   * @param options Configuration for capability generation.
   * @returns The capabilities object.
   */
  getRendererCapabilities(options?: CapabilitiesOptions): RendererCapabilities {
    // `version` can be used to fine-tune the returned capabilities.
    const version = options?.version ?? this.version;
    const versionCaps: Record<string, any> = {
      supportedCatalogIds: this.catalogs.map(c => c.id),
    };

    const inlineCatalogs = options?.includeInlineCatalogs
      ? this.catalogs.map(c => {
          if (version === 'v1.0') {
            return generateCatalogSchema(c, {
              componentEnvelopeRef: options?.componentEnvelopeRef,
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

    return {
      supportedCatalogIds: this.catalogs.map(c => c.id),
      ...(inlineCatalogs ? {inlineCatalogs} : {}),
      [version]: versionCaps,
    };
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
    const rawSchema = generateCatalogSchema(catalog, {componentEnvelopeRef});
    const components = (rawSchema.components as Record<string, unknown>) || {};

    const rawFunctions = rawSchema.functions as Record<string, Record<string, unknown>> | undefined;
    const functions: Array<Record<string, unknown>> = [];
    for (const fn of catalog.functions.values()) {
      const fnDef = rawFunctions?.[fn.name] as
        | {properties?: {args?: Record<string, unknown>}}
        | undefined;
      functions.push({
        name: fn.name,
        description: fn.description,
        returnType: fn.returnType,
        parameters: fnDef?.properties?.args ?? {type: 'object', properties: {}},
      });
    }

    const rawDefs = rawSchema.$defs as
      | Record<string, {properties?: Record<string, unknown>}>
      | undefined;
    const theme = rawDefs?.theme?.properties;

    return {
      catalogId: catalog.id,
      components,
      ...(functions.length > 0 ? {functions} : {}),
      ...(theme ? {theme} : {}),
    };
  }

  /**
   * Serializes active surface data models configured for client-to-agent reporting.
   *
   * @param version Protocol version to embed in the payload envelope.
   * @returns Serialized data model payload, or undefined if no surfaces stream data models.
   */
  getRendererDataModel(
    version: ProtocolVersion = this.version,
  ): Record<string, unknown> | undefined {
    const surfaces: Record<string, unknown> = {};

    for (const surface of this.model.surfacesMap.values()) {
      if (surface.sendDataModel) {
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
   * Processes a list of messages, a message wrapper, or raw operations.
   *
   * @param messages The messages or operations to process.
   */
  processMessages(messages: ProcessableMessagePayload): void {
    if (!messages || (Array.isArray(messages) && messages.length === 0)) return;

    if (this.validationConfig) {
      validateRecursionAndPaths(messages);
    }

    if (this.validationConfig?.targetVersion) {
      this.validateTargetVersion(messages);
    }

    if (
      typeof messages === 'object' &&
      'type' in (messages as Record<string, unknown>) &&
      typeof (messages as Record<string, unknown>).type === 'string' &&
      ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'].includes(
        (messages as Record<string, unknown>).type as string,
      )
    ) {
      this.processOperation(messages as InternalOperation);
      return;
    }

    let adapter;
    try {
      adapter = this.adapterRegistry.resolveFromPayload(messages);
    } catch {
      adapter = this.adapterRegistry.getAdapter(this.version);
    }

    const operations = adapter.extractOperations(messages);
    for (const op of operations) {
      this.processOperation(op);
    }
  }

  private validateTargetVersion(messages: ProcessableMessagePayload): void {
    const expected = this.validationConfig?.targetVersion;
    if (!expected) return;

    const checkMsg = (msg: unknown) => {
      if (typeof msg === 'object' && msg !== null && 'version' in msg) {
        const msgVer = (msg as {version?: string}).version;
        if (msgVer && msgVer !== expected) {
          throw new A2uiValidationError(
            `Message version '${msgVer}' does not match expected target version '${expected}'`,
          );
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

  /**
   * Processes a single canonical internal operation.
   *
   * @param op The internal operation to execute.
   */
  processOperation(op: InternalOperation): void {
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
    }
  }

  private processCreateSurfaceOp(op: InternalCreateSurfaceOp): void {
    const {surfaceId, catalogId, theme, sendDataModel, components, dataModel} = op;

    const catalog =
      catalogId !== undefined ? this.catalogs.find(c => c.id === catalogId) : this.catalogs[0];
    if (!catalog) {
      throw new A2uiStateError(`Catalog not found: ${catalogId}`);
    }

    if (this.model.getSurface(surfaceId)) {
      throw new A2uiStateError(`Surface ${surfaceId} already exists.`);
    }

    if (this.validationConfig) {
      if (catalog.themeSchema) {
        const themeResult = catalog.themeSchema.safeParse(theme);
        if (!themeResult.success) {
          throw new A2uiValidationError(
            `Validation failed for theme on surface '${surfaceId}': ${themeResult.error.message}`,
          );
        }
      }
    }

    const surface = new SurfaceModel<T>(surfaceId, catalog, theme, sendDataModel ?? false);
    this.model.addSurface(surface);

    if (dataModel) {
      for (const [key, val] of Object.entries(dataModel)) {
        const path = key.startsWith('/') ? key : `/${key}`;
        surface.dataModel.set(path, val);
      }
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

  private processUpdateComponentsOp(op: InternalUpdateComponentsOp): void {
    if (!op.surfaceId) return;

    const surface = this.model.getSurface(op.surfaceId);
    if (!surface) {
      throw new A2uiStateError(`Surface not found for message: ${op.surfaceId}`);
    }

    // 1. Validation pass: validate all components before mutating state
    for (const comp of op.components) {
      const {id, component, ...properties} = comp;
      const rawCatalogId = (comp as any).catalogId ?? (comp as any).catalogID;

      if (!id) {
        throw new A2uiValidationError(`Component '${component}' is missing an 'id'.`);
      }

      let targetCatalog = surface.catalog;
      if (typeof rawCatalogId === 'string' && rawCatalogId) {
        const found = this.catalogs.find(c => c.id === rawCatalogId);
        if (!found) {
          throw new A2uiValidationError(
            `Unknown catalog ID '${rawCatalogId}' for component '${id}'. Available catalogs: ${this.catalogs.map(c => c.id).join(', ')}`,
          );
        }
        targetCatalog = found;
      }

      const existing = surface.componentsModel.get(id);
      const componentType = component || existing?.type;
      if (!existing && !component) {
        throw new A2uiValidationError(`Cannot create component ${id} without a type.`);
      }
      if (componentType) {
        const componentApi = targetCatalog.components.get(componentType);
        if (!componentApi) {
          if (this.validationConfig && !this.validationConfig.allowUnknownElements) {
            throw new A2uiValidationError(
              `Unknown component type '${componentType}' not found in catalog '${targetCatalog.id}'.`,
            );
          }
        } else {
          const validationResult = componentApi.schema.safeParse(properties);
          if (!validationResult.success) {
            const formattedErrors = validationResult.error.errors.map(formatZodIssue).join(', ');
            console.error(
              "[A2UI Validation Error] Component '" + componentType + "' (" + id + '):',
              {
                propertyKeys: Object.keys(properties),
                issues: validationResult.error.issues,
              },
            );
            throw new A2uiValidationError(
              `Validation failed for component '${componentType}' (${id}): ${formattedErrors}`,
              validationResult.error.issues,
            );
          }
        }
      }
    }

    this.validateCompositionConstraints(surface, op.components);
    this.validateCandidateTopology(surface, op.components);

    // 2. Mutation pass: apply state updates
    for (const comp of op.components) {
      const {id, component, ...properties} = comp;
      const rawCatalogId = (comp as any).catalogId ?? (comp as any).catalogID;
      const existing = surface.componentsModel.get(id);

      let targetCatalog = surface.catalog;
      if (typeof rawCatalogId === 'string' && rawCatalogId) {
        const found = this.catalogs.find(c => c.id === rawCatalogId);
        if (found) {
          targetCatalog = found;
        }
      }

      if (existing) {
        const componentType = component || existing.type;
        if (
          componentType !== existing.type ||
          (rawCatalogId && existing.catalog?.id !== targetCatalog.id)
        ) {
          // Recreate component if type or catalog changes
          surface.componentsModel.removeComponent(id);
          const newComponent = new ComponentModel(id, componentType, properties, targetCatalog);
          surface.componentsModel.addComponent(newComponent);
        } else {
          existing.properties = properties;
        }
      } else {
        if (!component) {
          throw new A2uiValidationError(`Cannot create component ${id} without a type.`);
        }
        const newComponent = new ComponentModel(id, component, properties, targetCatalog);
        surface.componentsModel.addComponent(newComponent);
      }
    }
  }

  private processUpdateDataModelOp(op: InternalUpdateDataModelOp): void {
    if (!op.surfaceId) return;

    const surface = this.model.getSurface(op.surfaceId);
    if (!surface) {
      throw new A2uiStateError(`Surface not found for message: ${op.surfaceId}`);
    }

    const path = op.path || '/';
    const value = op.value;
    surface.dataModel.set(path, value);
  }

  private validateCompositionConstraints(
    surface: SurfaceModel<T>,
    newComponents: Array<Record<string, unknown>>,
  ): void {
    // 1. Build map of all component types and catalogs in the surface (combining existing & new)
    const typeMap = new Map<string, string>();
    const compCatalogMap = new Map<string, Catalog<T>>();
    const childMap = new Map<string, string[]>();

    for (const [id, model] of surface.componentsModel.entries) {
      typeMap.set(id, model.type);
      if (model.catalog) {
        compCatalogMap.set(id, model.catalog as Catalog<T>);
      }
      const children = surface.componentsModel.getChildIds(id);
      if (children.length > 0) {
        childMap.set(id, children);
      }
    }

    for (const comp of newComponents) {
      const {id, component, ...props} = comp;
      if (typeof id !== 'string') continue;

      let compCatalog = surface.catalog;
      const rawCatalogId = (comp as any).catalogId ?? (comp as any).catalogID;
      if (typeof rawCatalogId === 'string' && rawCatalogId) {
        const found = this.catalogs.find(c => c.id === rawCatalogId);
        if (found) {
          compCatalog = found;
          compCatalogMap.set(id, found);
        }
      }
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

    // Build parent map: childId -> Array<{ parentId, parentType }>
    const parentMap = new Map<string, Array<{parentId: string; parentType: string}>>();
    for (const [parentId, children] of childMap.entries()) {
      const parentType = typeMap.get(parentId) || 'Unknown';
      for (const childId of children) {
        const parents = parentMap.get(childId) ?? [];
        parents.push({parentId, parentType});
        parentMap.set(childId, parents);
      }
    }

    // 2. Validate constraints for each component
    for (const [id, componentType] of typeMap.entries()) {
      const compCatalog = compCatalogMap.get(id) ?? surface.catalog;
      const componentApi = compCatalog.components.get(componentType);
      if (!componentApi) continue;

      // Parent constraint validation
      if (componentApi.allowedParents && componentApi.allowedParents.length > 0) {
        const parents = parentMap.get(id);
        if (!parents || parents.length === 0) {
          const isRoot = id === 'root';
          const enforceTopLevel =
            isRoot ||
            (this.validationConfig && this.validationConfig.allowOrphanComponents === false);
          if (enforceTopLevel && !componentApi.allowedParents.includes('Surface')) {
            throw new A2uiValidationError(
              `Component '${id}' (${componentType}) cannot be placed under parent 'Surface' (Surface). Allowed parents: ${JSON.stringify(componentApi.allowedParents)}.`,
            );
          }
        } else {
          for (const parentInfo of parents) {
            if (!componentApi.allowedParents.includes(parentInfo.parentType)) {
              throw new A2uiValidationError(
                `Component '${id}' (${componentType}) cannot be placed under parent '${parentInfo.parentId}' (${parentInfo.parentType || 'unknown'}). Allowed parents: ${JSON.stringify(componentApi.allowedParents)}.`,
              );
            }
          }
        }
      }

      if (componentApi.allowedChildren && componentApi.allowedChildren.length > 0) {
        const children = childMap.get(id) || [];
        for (const childId of children) {
          const childType = typeMap.get(childId);
          if (childType && !componentApi.allowedChildren.includes(childType)) {
            throw new A2uiValidationError(
              `Container '${id}' (${componentType}) cannot contain child '${childId}' (${childType}). Allowed children: ${JSON.stringify(componentApi.allowedChildren)}.`,
            );
          }
        }
      }
    }
  }

  private validateCandidateTopology(
    surface: SurfaceModel<T>,
    newComponents: Array<Record<string, unknown>>,
  ): void {
    if (!this.validationConfig) return;

    const candidateModel = new SurfaceComponentsModel(surface.catalog);
    for (const [id, comp] of surface.componentsModel.entries) {
      candidateModel.addComponent(
        new ComponentModel(id, comp.type, comp.properties, comp.catalog as Catalog<T>),
      );
    }

    for (const comp of newComponents) {
      const {id, component, ...properties} = comp;
      if (typeof id !== 'string' || !id) continue;

      const rawCatalogId = (comp as any).catalogId ?? (comp as any).catalogID;
      let targetCatalog = surface.catalog;
      if (typeof rawCatalogId === 'string' && rawCatalogId) {
        const found = this.catalogs.find(c => c.id === rawCatalogId);
        if (found) {
          targetCatalog = found;
        }
      }

      const existing = candidateModel.get(id);
      const componentType = (typeof component === 'string' ? component : existing?.type) || '';
      if (!componentType) continue;

      if (existing) {
        if (
          componentType !== existing.type ||
          (rawCatalogId && existing.catalog?.id !== targetCatalog.id)
        ) {
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

    candidateModel.validateTopology(this.validationConfig);
  }
}
