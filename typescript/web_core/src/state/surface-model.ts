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
import {Catalog, ComponentApi} from '../catalog/types.js';
import {SurfaceComponentsModel} from './surface-components-model.js';
import {EventEmitter, EventSource} from '../common/events.js';

/** Representation of an action payload emitted by a renderer component. */
export interface ActionPayload {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
  [key: string]: unknown;
}

/** Representation of an error payload emitted by a surface. */
export interface A2uiErrorPayload {
  code: string;
  message: string;
  surfaceId?: string;
  expression?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A function that listens for actions emitted from a surface. */
export type ActionListener = (action: ActionPayload) => void | Promise<void>;

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

  private readonly _onAction = new EventEmitter<ActionPayload>();
  private readonly _onError = new EventEmitter<A2uiErrorPayload>();

  /** Fires whenever an action is dispatched from this surface. */
  readonly onAction: EventSource<ActionPayload> = this._onAction;

  /** Fires whenever an error occurs on this surface. */
  readonly onError: EventSource<A2uiErrorPayload> = this._onError;

  /**
   * Creates a new surface model.
   *
   * @param id The unique identifier for this surface.
   * @param catalog The component catalog used by this surface.
   * @param theme The theme to apply to this surface.
   * @param sendDataModel If true, the renderer will send the full data model.
   */
  constructor(
    readonly id: string,
    readonly catalog: Catalog<T>,
    readonly theme: any = {},
    readonly sendDataModel: boolean = false,
    dataModel?: DataModel,
  ) {
    this.dataModel = dataModel ?? new DataModel({});
    this.componentsModel = new SurfaceComponentsModel();
  }

  /**
   * Dispatches an action from this surface to listeners.
   *
   * @param payload The action payload (name/call and context/args) to dispatch.
   * @param sourceComponentId The ID of the component that triggered the action.
   */
  async dispatchAction(payload: any, sourceComponentId: string): Promise<void> {
    if (payload && typeof payload === 'object') {
      let eventPayload = payload;
      if ('event' in payload && payload.event) {
        eventPayload = payload.event;
      } else if ('functionCall' in payload && payload.functionCall) {
        eventPayload = payload.functionCall;
      }

      const actionToDispatch: ActionPayload = {
        name: eventPayload.name || eventPayload.call || '',
        surfaceId: this.id,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context: eventPayload.context || eventPayload.args || {},
      };

      await this._onAction.emit(actionToDispatch);
    }
  }

  /**
   * Dispatches an error from this surface to listeners.
   *
   * @param error The error object to dispatch, conforming to renderer_to_agent schema.
   */
  async dispatchError(error: A2uiErrorPayload): Promise<void> {
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
