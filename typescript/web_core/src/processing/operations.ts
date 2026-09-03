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
 * Canonical operation to execute a renderer function requested by the agent.
 */
export interface InternalCallRendererFunctionOp {
  /** Discriminator type for remote function calls on the renderer. */
  readonly type: 'callRendererFunction';
  /** Unique identifier for the function call. */
  readonly functionCallId: string;
  /** Function name to execute. */
  readonly call: string;
  /** Protocol version string. */
  readonly version: string;
  /** Optional catalog ID where the function is defined. */
  readonly catalogId?: string;
  /** Arguments passed to the function. */
  readonly args?: Record<string, unknown>;
  /** Whether user activation gesture context was present for the call. */
  readonly isUserActivated?: boolean;
}

/**
 * Canonical operation to resolve a pending renderer-initiated agent function call.
 */
export interface InternalAgentFunctionResponseOp {
  /** Discriminator type for inbound agent function responses. */
  readonly type: 'agentFunctionResponse';
  /** Unique identifier matching the initiating function call. */
  readonly functionCallId: string;
  /** Return value from agent function execution. */
  readonly value?: unknown;
  /** Error information if agent function execution failed. */
  readonly error?: {
    code: string;
    message: string;
  };
}

/**
 * Union of all version-agnostic internal operations processed by MessageProcessor.
 */
export type InternalOperation =
  | InternalCreateSurfaceOp
  | InternalUpdateComponentsOp
  | InternalUpdateDataModelOp
  | InternalDeleteSurfaceOp
  | InternalCallRendererFunctionOp
  | InternalAgentFunctionResponseOp;

/**
 * List of all canonical internal operation type discriminators.
 */
export const INTERNAL_OPERATION_TYPES = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
  'callRendererFunction',
  'agentFunctionResponse',
] as const;

/**
 * Discriminator string identifying the type of an internal operation.
 */
export type InternalOperationType = (typeof INTERNAL_OPERATION_TYPES)[number];

/**
 * Type guard to check if a value is a canonical InternalOperation object.
 *
 * @param payload The value to inspect.
 * @returns True if the payload conforms to an InternalOperation shape.
 */
export function isInternalOperation(payload: unknown): payload is InternalOperation {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    typeof (payload as Record<string, unknown>).type === 'string' &&
    (INTERNAL_OPERATION_TYPES as readonly string[]).includes(
      (payload as Record<string, unknown>).type as string,
    )
  );
}
