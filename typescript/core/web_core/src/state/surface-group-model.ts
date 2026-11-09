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

import {SurfaceModel, ActionPayload, A2uiErrorPayload} from './surface-model.js';
import {ComponentApi} from '../catalog/types.js';
import {EventEmitter, EventSource, Subscription} from '../common/events.js';

/**
 * Root state model managing a collection of active surfaces.
 *
 * @template T Component API type definition.
 */
export class SurfaceGroupModel<T extends ComponentApi> {
  private surfaces: Map<string, SurfaceModel<T>> = new Map();
  private surfaceUnsubscribers: Map<string, Subscription> = new Map();
  private surfaceErrorUnsubscribers: Map<string, Subscription> = new Map();

  private readonly _onSurfaceCreated = new EventEmitter<SurfaceModel<T>>();
  private readonly _onSurfaceDeleted = new EventEmitter<string>();
  private readonly _onAction = new EventEmitter<ActionPayload>();
  private readonly _onError = new EventEmitter<A2uiErrorPayload>();

  /** Event source firing when a new surface is added. */
  readonly onSurfaceCreated: EventSource<SurfaceModel<T>> = this._onSurfaceCreated;
  /** Event source firing when a surface is removed. */
  readonly onSurfaceDeleted: EventSource<string> = this._onSurfaceDeleted;
  /** Event source firing when an action is dispatched from any surface in the group. */
  readonly onAction: EventSource<ActionPayload> = this._onAction;
  /** Event source firing when an error is reported on any surface or at the group level. */
  readonly onError: EventSource<A2uiErrorPayload> = this._onError;

  /**
   * Emits a group-level error payload to all `onError` subscribers.
   *
   * @param error Structured error payload to emit.
   */
  emitError(error: A2uiErrorPayload): void {
    this._onError.emit(error);
  }

  /**
   * Adds a surface to the group.
   *
   * Ignores if a surface with the same ID already exists.
   *
   * @param surface The surface model to add.
   */
  addSurface(surface: SurfaceModel<T>): void {
    if (this.surfaces.has(surface.id)) {
      console.warn(`Surface ${surface.id} already exists. Ignoring.`);
      return;
    }

    this.surfaces.set(surface.id, surface);

    // Subscribe to surface actions and errors and propagate
    const sub = surface.onAction.subscribe(action => {
      void this._onAction.emit(action);
    });
    this.surfaceUnsubscribers.set(surface.id, sub);
    const errSub = surface.onError.subscribe(err => {
      void this._onError.emit(err);
    });
    this.surfaceErrorUnsubscribers.set(surface.id, errSub);

    this._onSurfaceCreated.emit(surface);
  }

  /**
   * Removes a surface from the group by its ID.
   *
   * Disposes of the surface upon removal.
   *
   * @param id The ID of the surface to remove.
   */
  deleteSurface(id: string): void {
    const surface = this.surfaces.get(id);
    if (surface) {
      const sub = this.surfaceUnsubscribers.get(id);
      if (sub) {
        sub.unsubscribe();
        this.surfaceUnsubscribers.delete(id);
      }
      const errSub = this.surfaceErrorUnsubscribers.get(id);
      if (errSub) {
        errSub.unsubscribe();
        this.surfaceErrorUnsubscribers.delete(id);
      }

      this.surfaces.delete(id);
      surface.dispose();
      this._onSurfaceDeleted.emit(id);
    }
  }

  /**
   * Retrieves a surface by its ID.
   *
   * @param id The ID of the surface to retrieve.
   * @returns The surface model, or undefined if not found.
   */
  getSurface(id: string): SurfaceModel<T> | undefined {
    return this.surfaces.get(id);
  }

  /**
   * Readonly map of all active surfaces keyed by surface ID.
   */
  get surfacesMap(): ReadonlyMap<string, SurfaceModel<T>> {
    return this.surfaces;
  }

  /**
   * Disposes the group and all contained surfaces.
   */
  dispose(): void {
    for (const id of Array.from(this.surfaces.keys())) {
      this.deleteSurface(id);
    }
    this._onSurfaceCreated.dispose();
    this._onSurfaceDeleted.dispose();
    this._onAction.dispose();
    this._onError.dispose();
  }
}
