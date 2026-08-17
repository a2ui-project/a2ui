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
  id: string;
  component?: string;
  [key: string]: unknown;
}

/**
 * Canonical operation to create a surface and initialize state.
 */
export interface InternalCreateSurfaceOp {
  readonly type: 'createSurface';
  readonly surfaceId: string;
  readonly catalogId?: string;
  readonly theme?: unknown;
  readonly sendDataModel?: boolean;
  readonly components?: InternalComponentPayload[];
  readonly dataModel?: Record<string, unknown>;
}

/**
 * Canonical operation to update components on a surface.
 */
export interface InternalUpdateComponentsOp {
  readonly type: 'updateComponents';
  readonly surfaceId: string;
  readonly components: InternalComponentPayload[];
}

/**
 * Canonical operation to update data model values at a JSON Pointer path.
 */
export interface InternalUpdateDataModelOp {
  readonly type: 'updateDataModel';
  readonly surfaceId: string;
  readonly path?: string;
  readonly value: unknown;
}

/**
 * Canonical operation to delete a surface.
 */
export interface InternalDeleteSurfaceOp {
  readonly type: 'deleteSurface';
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
