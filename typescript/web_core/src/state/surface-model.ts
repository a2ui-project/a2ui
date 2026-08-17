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

/** Action payload emitted by a renderer component. */
export interface ActionPayload {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
  [key: string]: unknown;
}

/** Error payload emitted by a surface. */
export interface A2uiErrorPayload {
  code: string;
  message: string;
  surfaceId?: string;
  expression?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Handler callback for actions emitted from a surface. */
export type ActionListener = (action: ActionPayload) => void | Promise<void>;

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

  /** Event source firing whenever an action is dispatched from this surface. */
  readonly onAction: EventSource<ActionPayload> = this._onAction;

  /** Event source firing whenever an error occurs on this surface. */
  readonly onError: EventSource<A2uiErrorPayload> = this._onError;

  /**
   * Initializes a new `SurfaceModel` instance.
   *
   * @param id Unique identifier for this surface.
   * @param catalog Component catalog used by this surface.
   * @param theme Theme configuration to apply to this surface.
   * @param sendDataModel Whether the renderer should stream data model updates back to the agent.
   */
  constructor(
    readonly id: string,
    readonly catalog: Catalog<T, F>,
    readonly theme: any = {},
    readonly sendDataModel: boolean = false,
    dataModel?: DataModel,
  ) {
    this.dataModel = dataModel ?? new DataModel({});
    this.componentsModel = new SurfaceComponentsModel(catalog);
  }

  /**
   * Dispatches an action from this surface to registered listeners.
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
   * Dispatches an error from this surface to registered listeners.
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
   * Disposes the surface, data model, components, and event emitters.
   */
  dispose(): void {
    this.dataModel.dispose();
    this.componentsModel.dispose();
    this._onAction.dispose();
    this._onError.dispose();
  }
}
