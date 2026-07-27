/*
 * Copyright 2025 Google LLC
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

import {ComponentModel} from './component-model.js';
import {EventEmitter, EventSource} from '../common/events.js';
import {A2uiStateError} from '../errors.js';

/**
 * Manages the collection of components for a specific surface.
 */
export class SurfaceComponentsModel {
  private components: Map<string, ComponentModel> = new Map();

  private readonly _onCreated = new EventEmitter<ComponentModel>();
  private readonly _onDeleted = new EventEmitter<string>();

  /** Fires when a new component is added to the model. */
  readonly onCreated: EventSource<ComponentModel> = this._onCreated;
  /** Fires when a component is removed, providing the ID of the deleted component. */
  readonly onDeleted: EventSource<string> = this._onDeleted;

  /**
   * Retrieves a component by its ID.
   *
   *
   * @param id The ID of the component to retrieve.
   * @returns The component model, or undefined if not found.
   */
  get(id: string): ComponentModel | undefined {
    return this.components.get(id);
  }

  /**
   * Returns an iterator over the components in the model.
   */
  get entries(): IterableIterator<[string, ComponentModel]> {
    return this.components.entries();
  }

  /**
   * Adds a component to the model.
   * Throws an error if a component with the same ID already exists.
   *
   * @param component The component to add.
   */
  addComponent(component: ComponentModel): void {
    if (this.components.has(component.id)) {
      throw new A2uiStateError(`Component with id '${component.id}' already exists.`);
    }

    this.components.set(component.id, component);
    this._onCreated.emit(component);
  }

  /**
   * Removes a component from the model by its ID.
   * Disposes of the component upon removal.
   *
   * @param id The ID of the component to remove.
   */
  removeComponent(id: string): void {
    const component = this.components.get(id);
    if (component) {
      this.components.delete(id);
      component.dispose();
      this._onDeleted.emit(id);
    }
  }

  /**
   * Disposes of the model and all its components.
   */
  dispose(): void {
    for (const component of this.components.values()) {
      component.dispose();
    }
    this.components.clear();
    this._onCreated.dispose();
    this._onDeleted.dispose();
  }
}
