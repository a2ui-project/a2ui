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

import {ReactiveController} from 'lit';
import {A2uiMetadata, Extensions} from '../common/metadata.js';
import {GenericBinder, ResolveA2uiProps} from '../resolution/generic-binder.js';
import {isComponentNode, type ComponentNode} from '../resolution/component-node.js';
import {ResolvedBinding, isWritable} from '../resolution/resolved-binding.js';
import {effect, getValue, peekValue} from '../reactivity/signals.js';
import {ComponentApi, InferredComponentApiSchemaType} from '../catalog/types.js';
import {A2uiLitElement} from './a2ui-lit-element.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toControllerValue(parent: ComponentNode, value: unknown): unknown {
  if (isComponentNode(value)) {
    return value.dataPath !== parent.dataPath
      ? {id: value.componentId, basePath: value.dataPath}
      : value.componentId;
  }
  if (value instanceof ResolvedBinding) {
    return toControllerValue(parent, value.value);
  }
  if (Array.isArray(value)) {
    return value.map(item => toControllerValue(parent, item));
  }
  if (isPlainObject(value)) {
    return nodePropsToControllerProps(parent, value);
  }
  return value;
}

/**
 * Converts `ComponentNode.props` into the controller `Props` shape expected by
 * `A2uiLitElement` views: unwraps each `ResolvedBinding` into its value and a
 * `set<CapitalizedKey>` callback, and converts child `ComponentNode` instances
 * into component IDs or `{id, basePath}` pairs.
 *
 * @internal
 */
export function nodePropsToControllerProps(
  parent: ComponentNode,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(props)) {
    if (inner instanceof ResolvedBinding) {
      result[key] = toControllerValue(parent, inner.value);
      result[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`] = isWritable(inner)
        ? inner.set
        : () => {};
    } else {
      result[key] = toControllerValue(parent, inner);
    }
  }
  return result;
}

/**
 * A Lit ReactiveController that binds an A2UI component node or context to its API schema.
 *
 * When the host element carries a resolved `ComponentNode` (`host.node`), this
 * controller reads directly from `node.props` without allocating a duplicate
 * `GenericBinder`. Otherwise, it falls back to managing a `GenericBinder`
 * subscription against `host.context`.
 *
 * @template Api The specific A2UI component API interface this controller is bound to.
 * @internal
 */
export class A2uiController<
  Api extends ComponentApi = ComponentApi,
  Props = ResolveA2uiProps<InferredComponentApiSchemaType<Api>>,
> implements ReactiveController {
  private _props: Props;

  /**
   * The current reactive properties of the A2UI component, matching the expected output schema.
   */
  public get props(): Props {
    return this._props;
  }

  /**
   * The current envelope metadata of the A2UI component, lazily subscribing
   * to metadata changes on first access so standard components that do not
   * read metadata skip metadata-only re-renders.
   */
  public get metadata(): A2uiMetadata | undefined {
    this.metadataSubscribed = true;
    if (this.host.isConnected) {
      this.ensureMetadataSubscription();
    }
    if (this.host.node) {
      return peekValue(this.host.node.metadata);
    }
    return this.host.context?.componentModel?.metadata;
  }

  /**
   * The current `extensions` map of the A2UI component's metadata envelope,
   * lazily subscribing to metadata changes on first access.
   */
  public get extensions(): Extensions | undefined {
    return this.metadata?.extensions;
  }

  /**
   * The current surface-level metadata envelope of the containing surface,
   * lazily subscribing to surface metadata changes on first access.
   */
  public get surfaceMetadata(): A2uiMetadata | undefined {
    this.surfaceMetadataSubscribed = true;
    if (this.host.isConnected) {
      this.ensureSurfaceMetadataSubscription();
    }
    const surface =
      this.host.node?.context?.dataContext.surface ?? this.host.context?.dataContext.surface;
    return surface?.metadata;
  }

  /**
   * The current surface-level `extensions` map of the containing surface,
   * lazily subscribing to surface metadata changes on first access.
   */
  public get surfaceExtensions(): Extensions | undefined {
    return this.surfaceMetadata?.extensions;
  }

  private binder?: GenericBinder<InferredComponentApiSchemaType<Api>>;
  private subscription?: {unsubscribe: () => void};
  private componentsSubscription?: {unsubscribe: () => void};
  private nodeEffectCleanup?: () => void;
  private metadataSubscribed = false;
  private metadataEffectCleanup?: () => void;
  private metadataSubscription?: {unsubscribe: () => void};
  private surfaceMetadataSubscribed = false;
  private surfaceMetadataSubscription?: {unsubscribe: () => void};

  /**
   * Initializes the controller, binding it to the given Lit element and API schema.
   *
   * @param host The A2uiLitElement acting as the component host.
   * @param api The A2UI component API defining the schema for this element.
   */
  constructor(
    private host: A2uiLitElement<any, any>,
    api: Api,
  ) {
    if (this.host.node) {
      this._props = nodePropsToControllerProps(
        this.host.node,
        peekValue(this.host.node.props),
      ) as Props;
    } else {
      this.binder = new GenericBinder(this.host.context, api.schema);
      this._props = this.binder.snapshot as Props;
    }
    this.host.addController(this);
    if (this.host.isConnected) {
      this.hostConnected();
    }
  }

  /**
   * Subscribes to `host.node.props` (or `GenericBinder` when no node is set)
   * when the host connects, triggering `requestUpdate()` on changes.
   */
  hostConnected() {
    this.ensureMetadataSubscription();
    this.ensureSurfaceMetadataSubscription();
    if (this.host.node) {
      if (!this.nodeEffectCleanup) {
        const node = this.host.node;
        this.nodeEffectCleanup = effect(() => {
          this._props = nodePropsToControllerProps(node, getValue(node.props)) as Props;
          this.host.requestUpdate();
        });
      }
      return;
    }
    if (!this.subscription && this.binder) {
      this.subscription = this.binder.subscribe(newProps => {
        this._props = newProps as Props;
        this.host.requestUpdate();
      });
    }
    if (!this.componentsSubscription) {
      this.componentsSubscription =
        this.host.context.dataContext.surface?.componentsModel?.onCreated.subscribe(() => {
          this.host.requestUpdate();
        });
    }
  }

  private ensureMetadataSubscription(): void {
    if (!this.metadataSubscribed) {
      return;
    }
    if (this.host.node) {
      if (!this.metadataEffectCleanup) {
        const node = this.host.node;
        let isFirstRun = true;
        this.metadataEffectCleanup = effect(() => {
          getValue(node.metadata);
          if (isFirstRun) {
            isFirstRun = false;
            return;
          }
          this.host.requestUpdate();
        });
      }
      return;
    }
    if (!this.metadataSubscription && this.host.context?.componentModel) {
      this.metadataSubscription = this.host.context.componentModel.onMetadataChanged.subscribe(
        () => {
          this.host.requestUpdate();
        },
      );
    }
  }

  private ensureSurfaceMetadataSubscription(): void {
    if (!this.surfaceMetadataSubscribed) {
      return;
    }
    const surface =
      this.host.node?.context?.dataContext.surface ?? this.host.context?.dataContext.surface;
    if (!this.surfaceMetadataSubscription && surface) {
      this.surfaceMetadataSubscription = surface.onMetadataChanged.subscribe(() => {
        this.host.requestUpdate();
      });
    }
  }

  /**
   * Unsubscribes from `node.props` or `GenericBinder` updates when the host disconnects.
   */
  hostDisconnected() {
    this.nodeEffectCleanup?.();
    this.nodeEffectCleanup = undefined;
    this.metadataEffectCleanup?.();
    this.metadataEffectCleanup = undefined;
    this.metadataSubscription?.unsubscribe();
    this.metadataSubscription = undefined;
    this.surfaceMetadataSubscription?.unsubscribe();
    this.surfaceMetadataSubscription = undefined;
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.componentsSubscription?.unsubscribe();
    this.componentsSubscription = undefined;
  }

  /**
   * Unsubscribes host listeners and disposes the underlying GenericBinder, if any.
   */
  dispose() {
    this.hostDisconnected();
    this.binder?.dispose();
  }
}
