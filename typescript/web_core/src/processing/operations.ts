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

/**
 * Generic component representation within internal processing operations.
 */
export interface InternalComponentPayload {
  /** Unique identifier of the component. */
  id: string;
  /** Component type name. */
  component?: string;
  [key: string]: unknown;
}

/**
 * Canonical operation to create a surface and initialize state.
 */
export interface InternalCreateSurfaceOp {
  /** Discriminator type for surface creation. */
  readonly type: 'createSurface';
  /** Target surface identifier. */
  readonly surfaceId: string;
  /** Optional catalog identifier to bind to the surface. */
  readonly catalogId?: string;
  /** Optional theme overrides or style parameters for the surface. */
  readonly theme?: unknown;
  /** Whether the client should stream data model updates back to the agent. */
  readonly sendDataModel?: boolean;
  /** Initial component definitions for the surface. */
  readonly components?: InternalComponentPayload[];
  /** Initial data model contents. */
  readonly dataModel?: Record<string, unknown>;
}

/**
 * Canonical operation to update components on a surface.
 */
export interface InternalUpdateComponentsOp {
  /** Discriminator type for component updates. */
  readonly type: 'updateComponents';
  /** Target surface identifier. */
  readonly surfaceId: string;
  /** Array of component definitions to add or update. */
  readonly components: InternalComponentPayload[];
}

/**
 * Canonical operation to update data model values at a JSON Pointer path.
 */
export interface InternalUpdateDataModelOp {
  /** Discriminator type for data model updates. */
  readonly type: 'updateDataModel';
  /** Target surface identifier. */
  readonly surfaceId: string;
  /** Optional JSON Pointer path within the data model. */
  readonly path?: string;
  /** Value to set at the specified path. */
  readonly value: unknown;
}

/**
 * Canonical operation to delete a surface.
 */
export interface InternalDeleteSurfaceOp {
  /** Discriminator type for surface deletion. */
  readonly type: 'deleteSurface';
  /** Target surface identifier to delete. */
  readonly surfaceId: string;
}

/**
 * Union of all version-agnostic internal operations processed by MessageProcessor.
 */
export type InternalOperation =
  | InternalCreateSurfaceOp
  | InternalUpdateComponentsOp
  | InternalUpdateDataModelOp
  | InternalDeleteSurfaceOp;
