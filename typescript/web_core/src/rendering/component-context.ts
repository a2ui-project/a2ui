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

import {DataContext} from './data-context.js';
import {ComponentModel} from '../state/component-model.js';
import type {SurfaceModel} from '../state/surface-model.js';
import type {SurfaceComponentsModel} from '../state/surface-components-model.js';
import type {ComponentApi} from '../catalog/types.js';
import type {Action} from '../types/common-types.js';
import {A2uiStateError} from '../errors.js';

/**
 * Context provided to components during rendering.
 *
 * Provides access to the component's model, the data context, and action dispatching.
 */
export class ComponentContext {
  /** State model for this specific component, providing access to its properties and state. */
  readonly componentModel: ComponentModel;
  /**
   * Data context scoped to this component's position in the visual hierarchy.
   *
   * Uses `dataModelBasePath` to resolve relative data paths.
   */
  readonly dataContext: DataContext;
  /** Collection of all component models for the current surface, allowing lookups by ID. */
  readonly surfaceComponents: SurfaceComponentsModel;
  /** Theme configuration for the surface this component belongs to. */
  readonly theme: Record<string, unknown> | undefined;

  /**
   * Initializes a new `ComponentContext` instance.
   *
   * @param surface The surface model the component belongs to.
   * @param componentId The ID of the component.
   * @param dataModelBasePath The base path for data model access (default: '/').
   */
  constructor(
    surface: SurfaceModel<ComponentApi>,
    componentId: string,
    dataModelBasePath: string = '/',
  ) {
    const model = surface.componentsModel.get(componentId);
    if (!model) {
      throw new A2uiStateError(`Component not found: ${componentId}`);
    }
    this.componentModel = model;
    this.surfaceComponents = surface.componentsModel;
    this.theme = surface.theme;

    this.dataContext = new DataContext(surface, dataModelBasePath);
    this._actionDispatcher = action => surface.dispatchAction(action, this.componentModel.id);
  }

  private _actionDispatcher: (action: Action | Record<string, unknown>) => Promise<void>;

  /**
   * Dispatches an action from the component.
   *
   * @param action The action to dispatch.
   * @returns A promise that resolves when action dispatching completes.
   */
  dispatchAction(action: Action | Record<string, unknown>): Promise<void> {
    return this._actionDispatcher(action);
  }
}
