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

import {Catalog} from '../catalog/types.js';
import {EventEmitter, EventSource} from '../common/events.js';
import {
  A2uiMetadata,
  cloneMetadata,
  Extensions,
  jsonValueEquals,
  metadataEquals,
} from '../common/metadata.js';
import {peekValue, setValue, signal, Signal} from '../reactivity/signals.js';

/**
 * State model for an individual UI component.
 */
export class ComponentModel {
  private _properties: Record<string, any>;
  private readonly _onUpdated = new EventEmitter<ComponentModel>();
  private readonly _onMetadataChanged = new EventEmitter<A2uiMetadata | undefined>();
  private readonly _metadataSignal: Signal<A2uiMetadata | undefined>;

  /**
   * Event source firing whenever component properties are updated.
   */
  readonly onUpdated: EventSource<ComponentModel> = this._onUpdated;

  /**
   * Event source firing whenever component metadata changes.
   */
  readonly onMetadataChanged: EventSource<A2uiMetadata | undefined> = this._onMetadataChanged;

  /**
   * The catalog that defines this component's type.
   *
   * Always set by the message processor. Only pre-1.0 callers that construct
   * a `ComponentModel` directly, such as unit tests, may leave it out, in
   * which case it is `undefined` at runtime despite the type.
   */
  readonly catalog!: Catalog<any, any>;

  /**
   * Initializes a new `ComponentModel` instance.
   *
   * @param id The unique identifier for this component.
   * @param type The component type name.
   * @param initialProperties The initial properties for the component.
   * @param catalog The catalog that defines this component's type. Omitting
   *   it is deprecated and kept only for pre-1.0 callers; pass the catalog.
   * @param metadata Optional component-level metadata envelope.
   */
  constructor(
    readonly id: string,
    readonly type: string,
    initialProperties: Record<string, any>,
    catalog?: Catalog<any, any>,
    metadata?: A2uiMetadata,
  ) {
    this._properties = initialProperties;
    this.catalog = catalog as Catalog<any, any>;
    this._metadataSignal = signal<A2uiMetadata | undefined>(cloneMetadata(metadata));
  }

  /**
   * Internal metadata signal used by `NodeResolver` to derive `ComponentNode.metadata`.
   *
   * @internal
   */
  get metadataSignal(): Signal<A2uiMetadata | undefined> {
    return this._metadataSignal;
  }

  /**
   * Synchronous snapshot of the component's metadata envelope.
   */
  get metadata(): A2uiMetadata | undefined {
    return peekValue(this._metadataSignal);
  }

  /**
   * Replaces the component's metadata envelope, validating UAX #31 extension
   * keys and emitting changes when structurally modified.
   */
  set metadata(metadata: A2uiMetadata | undefined) {
    const next = cloneMetadata(metadata);
    if (metadataEquals(peekValue(this._metadataSignal), next)) {
      return;
    }
    setValue(this._metadataSignal, next);
    void this._onMetadataChanged.emit(next);
  }

  /**
   * Convenience view of `metadata.extensions`.
   */
  get extensions(): Extensions | undefined {
    return peekValue(this._metadataSignal)?.extensions;
  }

  /**
   * Sets a single extension entry on the component metadata.
   *
   * Passing `undefined` removes the extension key. Passing `null` stores
   * `null` as an explicit JSON value.
   *
   * @param key Extension identifier (must satisfy UAX #31).
   * @param value Extension payload value.
   */
  setExtension(key: string, value: unknown): void {
    if (value === undefined) {
      this.removeExtension(key);
      return;
    }
    const current = peekValue(this._metadataSignal);
    const nextExtensions: Record<string, unknown> = {
      ...(current?.extensions ?? {}),
      [key]: value,
    };
    this.metadata = {
      ...(current ?? {}),
      extensions: nextExtensions,
    };
  }

  /**
   * Removes an extension entry by key, clearing `metadata` to `undefined` when
   * no metadata entries remain.
   *
   * @param key Extension identifier to remove.
   */
  removeExtension(key: string): void {
    const current = peekValue(this._metadataSignal);
    const currentExtensions = current?.extensions;
    if (!currentExtensions || !(key in currentExtensions)) {
      return;
    }
    const nextExtensions: Record<string, unknown> = {...currentExtensions};
    delete nextExtensions[key];
    const rest: Record<string, unknown> = {...current};
    delete rest.extensions;
    if (Object.keys(nextExtensions).length > 0) {
      this.metadata = {...rest, extensions: nextExtensions};
    } else if (Object.keys(rest).length > 0) {
      this.metadata = rest;
    } else {
      this.metadata = undefined;
    }
  }

  /**
   * Current properties of the component.
   */
  get properties(): Record<string, any> {
    return this._properties;
  }

  set properties(newProperties: Record<string, any>) {
    this._properties = newProperties;
    void this._onUpdated.emit(this);
  }

  /**
   * Atomically updates both properties and metadata before emitting update
   * notifications, ensuring synchronous listeners never observe torn state.
   *
   * @param newProperties Replacement component properties.
   * @param newMetadata Replacement component metadata envelope, or `undefined`.
   */
  applyUpdate(newProperties: Record<string, any>, newMetadata: A2uiMetadata | undefined): void {
    const nextMeta = cloneMetadata(newMetadata);
    const propsChanged = !jsonValueEquals(this._properties, newProperties);
    const metaChanged = !metadataEquals(peekValue(this._metadataSignal), nextMeta);
    if (propsChanged) {
      this._properties = newProperties;
    }
    if (metaChanged) {
      setValue(this._metadataSignal, nextMeta);
    }
    if (propsChanged) {
      void this._onUpdated.emit(this);
    }
    if (metaChanged) {
      void this._onMetadataChanged.emit(nextMeta);
    }
  }

  /**
   * Disposes the component model and its update event emitters.
   */
  dispose(): void {
    this._onUpdated.dispose();
    this._onMetadataChanged.dispose();
  }

  /**
   * Serialized JSON representation of the component definition.
   */
  get componentTree(): any {
    const metadata = this.metadata;
    return {
      ...this._properties,
      id: this.id,
      component: this.type,
      ...(metadata !== undefined ? {metadata} : {}),
    };
  }
}
