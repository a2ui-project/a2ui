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

import {DataModel} from './data-model.js';
import {Catalog, ComponentApi} from '../catalog/types.js';
import {SurfaceComponentsModel} from './surface-components-model.js';
import {EventEmitter, EventSource} from '../common/events.js';
import {A2uiClientAction, A2uiClientActionSchema} from '../schema/client-to-server.js';

/** A function that listens for actions emitted from a surface. */
export type ActionListener = (action: A2uiClientAction) => void | Promise<void>;

/**
 * The state model for a single UI surface.
 *
 * A surface is the root container for a set of components and their associated data.
 * It coordinates data binding, component state, and action dispatching.
 *
 * @template T The concrete type of the ComponentApi from the catalog.
 */
export class SurfaceModel<T extends ComponentApi = ComponentApi> {
  /** The data model for this surface. */
  readonly dataModel: DataModel;
  /** The collection of component models for this surface. */
  readonly componentsModel: SurfaceComponentsModel;

  private readonly _onAction = new EventEmitter<A2uiClientAction>();
  private readonly _onError = new EventEmitter<any>();

  /** Fires whenever an action is dispatched from this surface. */
  readonly onAction: EventSource<A2uiClientAction> = this._onAction;

  /** Fires whenever an error occurs on this surface. */
  readonly onError: EventSource<any> = this._onError;

  /**
   * Creates a new surface model.
   *
   * @param id The unique identifier for this surface.
   * @param catalog The component catalog used by this surface.
   * @param theme The theme to apply to this surface.
   * @param sendDataModel If true, the client will send the full data model.
   */
  constructor(
    readonly id: string,
    readonly catalog: Catalog<T>,
    readonly theme: any = {},
    readonly sendDataModel: boolean = false,
  ) {
    this.dataModel = new DataModel({});
    this.componentsModel = new SurfaceComponentsModel();
  }

  /**
   * Dispatches an action from this surface to listeners.
   *
   * @param payload The action payload (name and context) to dispatch.
   * @param sourceComponentId The ID of the component that triggered the action.
   */
  async dispatchAction(payload: any, sourceComponentId: string): Promise<void> {
    if (payload && typeof payload === 'object' && 'event' in payload && payload.event) {
      const actionToValidate = {
        name: payload.event.name,
        surfaceId: this.id,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context: payload.event.context || {},
      };

      const validationResult = A2uiClientActionSchema.safeParse(actionToValidate);
      if (validationResult.success) {
        await this._onAction.emit(validationResult.data);
      } else {
        console.error('A2UI: Invalid action payload dispatched.', validationResult.error.format());
      }
    }
    // Note: local functionCall actions are currently handled by the renderer or binder
    // and do not necessarily need to be emitted here if they are not intended for the server.
  }

  /**
   * Dispatches an error from this surface to listeners.
   *
   * @param error The error object to dispatch, conforming to client_to_server schema.
   */
  async dispatchError(error: {code: string; message: string; [key: string]: any}): Promise<void> {
    await this._onError.emit({
      ...error,
      surfaceId: this.id,
    });
  }

  /**
   * Disposes of the surface and its resources.
   */
  dispose(): void {
    this.dataModel.dispose();
    this.componentsModel.dispose();
    this._onAction.dispose();
    this._onError.dispose();
  }
}
