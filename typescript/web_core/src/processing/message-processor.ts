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
import {SurfaceGroupModel} from '../state/surface-group-model.js';
import {ComponentModel} from '../state/component-model.js';
import {Subscription} from '../common/events.js';
import {zodToJsonSchema} from 'zod-to-json-schema';
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

import {ProtocolVersion, VersionAdapter} from './adapters/base.js';
import {RendererCapabilities} from '../v1_0/schema/index.js';
export type {RendererCapabilities};

/**
 * Interface for version adapter resolution services.
 */
export interface VersionAdapterResolver {
  getAdapter(version: string): VersionAdapter;
  resolveFromPayload(payload: unknown): VersionAdapter;
}

/**
 * Options for generating renderer capabilities.
 */
export interface CapabilitiesOptions {
  /** If true, the full definition of all catalogs will be included. */
  includeInlineCatalogs?: boolean;
  /** The protocol version to generate capabilities for. Defaults to the processor's configured version. */
  version?: ProtocolVersion;
  /** The base schema $ref to wrap component definitions in inline catalogs. Defaults to 'common_types.json#/$defs/ComponentCommon'. */
  componentEnvelopeRef?: string;
}

/**
 * Options for configuring a MessageProcessor instance.
 */
export interface MessageProcessorOptions {
  /** The default protocol version to use for capability generation and data model reporting. Defaults to 'v0.9'. */
  version?: ProtocolVersion;
  /** Custom version adapter resolver or registry. Defaults to VersionAdapterFactory. */
  adapterRegistry?: VersionAdapterResolver;
  /** Enable strict mode schema and topology validation. */
  strictMode?: boolean;
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
 * The central processor for A2UI messages.
 * @template T The concrete type of the ComponentApi.
 */
export class MessageProcessor<T extends ComponentApi> {
  readonly model: SurfaceGroupModel<T>;
  readonly version: ProtocolVersion;
  private readonly adapterRegistry: VersionAdapterResolver;
  private readonly strictMode: boolean;

  /**
   * Creates a new message processor.
   *
   * @param catalogs A list of available catalogs.
   * @param actionHandler A global handler for actions from all surfaces.
   * @param options Configuration options for the processor.
   */
  constructor(
    private catalogs: Catalog<T>[],
    private actionHandler?: ActionListener,
    options?: MessageProcessorOptions,
  ) {
    this.model = new SurfaceGroupModel<T>();
    this.version = options?.version ?? 'v0.9';
    this.adapterRegistry = options?.adapterRegistry ?? defaultVersionAdapterFactory;
    this.strictMode = Boolean(options?.strictMode);
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

    if (options?.includeInlineCatalogs) {
      versionCaps.inlineCatalogs = this.catalogs.map(c =>
        this.generateInlineCatalog(c, options?.componentEnvelopeRef),
      );
    }

    return {
      supportedCatalogIds: this.catalogs.map(c => c.id),
      ...(options?.includeInlineCatalogs
        ? {
            inlineCatalogs: this.catalogs.map(c =>
              this.generateInlineCatalog(c, options?.componentEnvelopeRef),
            ),
          }
        : {}),
      [version]: versionCaps,
    };
  }

  private generateInlineCatalog(
    catalog: Catalog<T>,
    componentEnvelopeRef = 'common_types.json#/$defs/ComponentCommon',
  ): Record<string, unknown> {
    const components: Record<string, unknown> = {};

    for (const [name, api] of catalog.components.entries()) {
      const zodSchema = zodToJsonSchema(api.schema, {
        target: 'jsonSchema2019-09',
      }) as Record<string, unknown>;

      // Clean up Zod-specific artifacts and process REF: tags
      this.processRefs(zodSchema);

      // Wrap in standard A2UI component envelope (ComponentCommon)
      components[name] = {
        allOf: [
          {$ref: componentEnvelopeRef},
          {
            properties: {
              component: {const: name},
              ...((zodSchema.properties as Record<string, unknown>) || {}),
            },
            required: ['component', ...((zodSchema.required as string[]) || [])],
          },
        ],
      };
    }

    const functions: Array<Record<string, unknown>> = [];
    for (const api of catalog.functions.values()) {
      const zodSchema = zodToJsonSchema(api.schema, {
        target: 'jsonSchema2019-09',
      }) as Record<string, unknown>;

      this.processRefs(zodSchema);

      functions.push({
        name: api.name,
        description: api.schema.description,
        returnType: api.returnType,
        parameters: zodSchema,
      });
    }

    let theme: Record<string, unknown> | undefined;
    if (catalog.themeSchema) {
      const zodSchema = zodToJsonSchema(catalog.themeSchema, {
        target: 'jsonSchema2019-09',
      }) as Record<string, unknown>;

      this.processRefs(zodSchema);
      theme = zodSchema.properties as Record<string, unknown>;
    }

    return {
      catalogId: catalog.id,
      components,
      functions: functions.length > 0 ? functions : undefined,
      theme,
    };
  }

  private processRefs(node: unknown): void {
    if (typeof node !== 'object' || node === null) return;
    const obj = node as Record<string, unknown>;

    // If the node itself is a REF target, transform it and stop recursion.
    if (typeof obj.description === 'string' && obj.description.startsWith('REF:')) {
      const parts = obj.description.substring(4).split('|');
      const ref = parts[0];
      const desc = parts[1] || '';

      // Clear the node of all other properties.
      for (const k of Object.keys(obj)) {
        delete obj[k];
      }

      // Re-add only the $ref and an optional description.
      obj['$ref'] = ref;
      if (desc) {
        obj['description'] = desc;
      }
      return;
    }

    // If not a REF target, recurse into its children.
    if (Array.isArray(node)) {
      for (const item of node) {
        this.processRefs(item);
      }
    } else {
      for (const key of Object.keys(obj)) {
        this.processRefs(obj[key]);
      }
    }
  }

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
   */
  getSurfaces(): ReadonlyMap<string, SurfaceModel<T>> {
    return this.model.surfacesMap;
  }

  /**
   * Retrieves an active surface by its ID.
   *
   * @param id The surface ID.
   */
  getSurface(id: string): SurfaceModel<T> | undefined {
    return this.model.getSurface(id);
  }

  /**
   * Subscribes to surface creation events.
   */
  onSurfaceCreated(handler: (surface: SurfaceModel<T>) => void): Subscription {
    return this.model.onSurfaceCreated.subscribe(handler);
  }

  /**
   * Subscribes to surface deletion events.
   */
  onSurfaceDeleted(handler: (id: string) => void): Subscription {
    return this.model.onSurfaceDeleted.subscribe(handler);
  }

  /**
   * Processes a list of messages, a message wrapper, or raw operations.
   *
   * @param messages The messages or operations to process.
   */
  processMessages(messages: unknown): void {
    if (!messages) return;

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

  processOperation(op: InternalOperation): void {
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

    if (this.strictMode) {
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

      if (!id) {
        throw new A2uiValidationError(`Component '${component}' is missing an 'id'.`);
      }

      const componentType = component;
      const mergedProperties = properties;
      if (componentType) {
        const componentApi = surface.catalog.components.get(componentType);
        if (componentApi) {
          const validationResult = componentApi.schema.safeParse(mergedProperties);
          if (!validationResult.success) {
            const formattedErrors = validationResult.error.errors.map(formatZodIssue).join(', ');
            console.error(
              "[A2UI Validation Error] Component '" + componentType + "' (" + id + '):',
              {
                propertyKeys: Object.keys(mergedProperties),
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

    // 2. Mutation pass: apply state updates
    for (const comp of op.components) {
      const {id, component, ...properties} = comp;
      const existing = surface.componentsModel.get(id);
      const mergedProperties = existing ? {...existing.properties, ...properties} : properties;

      if (existing) {
        if (component && component !== existing.type) {
          // Recreate component if type changes
          surface.componentsModel.removeComponent(id);
          const newComponent = new ComponentModel(id, component, mergedProperties);
          surface.componentsModel.addComponent(newComponent);
        } else {
          existing.properties = mergedProperties;
        }
      } else {
        if (!component) {
          throw new A2uiValidationError(`Cannot create component ${id} without a type.`);
        }
        const newComponent = new ComponentModel(id, component, properties);
        surface.componentsModel.addComponent(newComponent);
      }
    }

    if (this.strictMode) {
      this.validateTopology(surface);
    }
  }

  private validateTopology(surface: SurfaceModel<T>): void {
    const components = surface.componentsModel;
    if (components.size === 0) return;

    // Root presence check
    if (!components.get('root')) {
      throw new A2uiValidationError('Missing root component');
    }
    const rootId = 'root';

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const isChildRefDef = (schema: any, keyName?: string): boolean => {
      if (!schema || typeof schema !== 'object') return false;
      let current = schema;
      while (current?._def) {
        const typeName = current._def.typeName;
        if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
          current = current._def.innerType;
        } else if (typeName === 'ZodEffects') {
          current = current._def.schema;
        } else {
          break;
        }
      }

      const desc: string = current?.description ?? current?._def?.description ?? '';
      if (desc.includes('ChildList') || desc.includes('ComponentId') || desc.includes('Child')) {
        return true;
      }

      if (
        keyName &&
        (keyName === 'child' ||
          keyName === 'children' ||
          keyName.endsWith('Child') ||
          keyName === 'root')
      ) {
        return true;
      }

      // Check structural definition of ChildList (Union containing array and { componentId, path } template)
      if (current?._def?.typeName === 'ZodUnion') {
        const options = (current._def.options as any[]) ?? [];
        const hasTemplate = options.some(
          o =>
            o?._def?.typeName === 'ZodObject' &&
            typeof o._def.shape === 'function' &&
            o._def.shape().componentId &&
            o._def.shape().path,
        );
        if (hasTemplate) return true;
      }

      return false;
    };

    const findChildProperties = (schema: any): Set<string> => {
      const childKeys = new Set<string>();
      if (!schema || typeof schema !== 'object') return childKeys;

      let current = schema;
      while (current?._def) {
        const typeName = current._def.typeName;
        if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
          current = current._def.innerType;
        } else if (typeName === 'ZodEffects') {
          current = current._def.schema;
        } else {
          break;
        }
      }

      if (current?._def?.typeName === 'ZodObject' && typeof current._def.shape === 'function') {
        const shape = current._def.shape();
        for (const [key, fieldSchema] of Object.entries(shape)) {
          if (isChildRefDef(fieldSchema, key)) {
            childKeys.add(key);
          } else {
            let inner = fieldSchema as any;
            while (inner?._def) {
              const tn = inner._def.typeName;
              if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodDefault') {
                inner = inner._def.innerType;
              } else if (tn === 'ZodEffects') {
                inner = inner._def.schema;
              } else {
                break;
              }
            }
            if (inner?._def?.typeName === 'ZodArray') {
              if (isChildRefDef(inner._def.type, key)) {
                childKeys.add(key);
              } else if (inner._def.type?._def?.typeName === 'ZodObject') {
                const nestedKeys = findChildProperties(inner._def.type);
                if (nestedKeys.size > 0) {
                  childKeys.add(key);
                }
              }
            } else if (inner?._def?.typeName === 'ZodObject') {
              const nestedKeys = findChildProperties(inner);
              if (nestedKeys.size > 0) {
                childKeys.add(key);
              }
            }
          }
        }
      }

      return childKeys;
    };

    const getChildren = (compId: string): string[] => {
      const comp = components.get(compId);
      if (!comp) return [];
      const children: string[] = [];

      const addRef = (val: unknown) => {
        if (typeof val === 'string' && val.length > 0) {
          children.push(val);
        }
      };

      const extractChildRefs = (val: unknown) => {
        if (!val) return;
        if (typeof val === 'string') {
          addRef(val);
        } else if (Array.isArray(val)) {
          for (const item of val) {
            extractChildRefs(item);
          }
        } else if (typeof val === 'object' && val !== null) {
          if ('componentId' in val && typeof (val as any).componentId === 'string') {
            addRef((val as any).componentId);
          }
          if ('child' in val && typeof (val as any).child === 'string') {
            addRef((val as any).child);
          }
        }
      };

      const compApi = surface.catalog.components.get(comp.type);
      if (compApi?.schema) {
        const childPropKeys = findChildProperties(compApi.schema);
        for (const key of childPropKeys) {
          const val = comp.properties[key];
          if (val !== undefined && val !== null) {
            extractChildRefs(val);
          }
        }
      } else {
        // Fallback for catalog-less / dynamic components without schema
        for (const [k, v] of Object.entries(comp.properties)) {
          if (k === 'id') continue;
          if (
            k === 'child' ||
            k === 'children' ||
            k === 'items' ||
            k === 'components' ||
            k.endsWith('Child')
          ) {
            extractChildRefs(v);
          }
        }
      }

      return children;
    };

    const dfs = (currId: string) => {
      visiting.add(currId);
      visited.add(currId);

      const children = getChildren(currId);
      for (const childId of children) {
        if (!components.get(childId)) {
          throw new A2uiValidationError(`Dangling reference '${childId}' in component '${currId}'`);
        }
        if (visiting.has(childId)) {
          throw new A2uiValidationError(`Circular reference detected in component hierarchy`);
        }
        if (!visited.has(childId)) {
          dfs(childId);
        }
      }

      visiting.delete(currId);
    };

    dfs(rootId);

    if (visited.size < components.size) {
      for (const comp of components.values) {
        if (!visited.has(comp.id)) {
          throw new A2uiValidationError(
            `Orphaned component '${comp.id}' is not reachable from root`,
          );
        }
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

  private extractChildIds(childVal: unknown, list: string[] = []): string[] {
    if (!childVal) return list;

    if (typeof childVal === 'string') {
      list.push(childVal);
    } else if (Array.isArray(childVal)) {
      for (const item of childVal) {
        if (typeof item === 'string') {
          list.push(item);
        } else if (
          item &&
          typeof item === 'object' &&
          'componentId' in item &&
          typeof (item as {componentId: unknown}).componentId === 'string'
        ) {
          list.push((item as {componentId: string}).componentId);
        }
      }
    } else if (
      typeof childVal === 'object' &&
      'componentId' in childVal &&
      typeof (childVal as {componentId: unknown}).componentId === 'string'
    ) {
      list.push((childVal as {componentId: string}).componentId);
    }
    return list;
  }

  private extractChildIdsFromProps(props: Record<string, unknown>, list: string[] = []): string[] {
    if (!props || typeof props !== 'object') return list;
    for (const [key, val] of Object.entries(props)) {
      if (key === 'id' || key === 'component') continue;
      this.extractChildIds(val, list);
    }
    return list;
  }

  private validateCompositionConstraints(
    surface: SurfaceModel<T>,
    newComponents: Array<Record<string, unknown>>,
  ): void {
    // 1. Build map of all component types in the surface (combining existing & new)
    const typeMap = new Map<string, string>();
    const childMap = new Map<string, string[]>();

    for (const [id, model] of surface.componentsModel.entries) {
      typeMap.set(id, model.type);
      const props = model.properties || {};
      const list: string[] = [];
      this.extractChildIdsFromProps(props, list);
      if (list.length > 0) {
        childMap.set(id, list);
      }
    }

    for (const comp of newComponents) {
      const {id, component, ...props} = comp;
      if (typeof id === 'string' && typeof component === 'string') {
        typeMap.set(id, component);
      }
      if (typeof id === 'string') {
        const list: string[] = [];
        this.extractChildIdsFromProps(props, list);
        if (list.length > 0) {
          childMap.set(id, list);
        } else {
          childMap.delete(id);
        }
      }
    }

    // Build parent map: childId -> { parentId, parentType }
    const parentMap = new Map<string, {parentId: string; parentType: string}>();
    for (const [parentId, children] of childMap.entries()) {
      const parentType = typeMap.get(parentId) || 'Unknown';
      for (const childId of children) {
        parentMap.set(childId, {parentId, parentType});
      }
    }

    // 2. Validate constraints for each component
    for (const [id, componentType] of typeMap.entries()) {
      const componentApi = surface.catalog.components.get(componentType);
      if (!componentApi) continue;

      // Parent constraint validation
      if (componentApi.allowedParents && componentApi.allowedParents.length > 0) {
        const parentInfo = parentMap.get(id);
        const isRoot = !parentInfo;
        const parentType = isRoot ? 'Surface' : parentInfo.parentType;
        const parentId = isRoot ? 'Surface' : parentInfo.parentId;

        if (!parentType || !componentApi.allowedParents.includes(parentType)) {
          throw new A2uiValidationError(
            `Component '${id}' (${componentType}) cannot be placed under parent '${parentId}' (${parentType || 'unknown'}). Allowed parents: ${JSON.stringify(componentApi.allowedParents)}.`,
          );
        }
      }

      // Child constraint validation
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
}
