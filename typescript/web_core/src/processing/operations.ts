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

import type {ProtocolVersion} from './adapters/base.js';

/**
 * Generic component representation within internal processing operations.
 */
export interface InternalComponentPayload {
  /** Identifier for the component instance within a surface. */
  id: string;
  /** Component type name as defined in the catalog (e.g. `'Button'`, `'Column'`). */
  component?: string;
  /** Additional component properties, children references, or data bindings. */
  [key: string]: unknown;
}

/**
 * Operation to create a surface and initialize its state and component tree.
 */
export interface InternalCreateSurfaceOp {
  /** Discriminator indicating surface creation. */
  readonly type: 'createSurface';
  /** Identifier of the surface to create. */
  readonly surfaceId: string;
  /** Identifier of the component catalog to bind to this surface. If omitted, uses the default catalog. */
  readonly catalogId?: string;
  /** Styling tokens or theme configuration to apply to the surface. */
  readonly theme?: unknown;
  /** Whether the client should send data model mutations back to the agent. */
  readonly sendDataModel?: boolean;
  /** Initial component tree definitions to instantiate on the surface. */
  readonly components?: InternalComponentPayload[];
  /** Initial key-value state tree for the surface data model. */
  readonly dataModel?: Record<string, unknown>;
}

/**
 * Operation to add, update, or replace component definitions within an existing surface.
 */
export interface InternalUpdateComponentsOp {
  /** Discriminator indicating component updates. */
  readonly type: 'updateComponents';
  /** Identifier of the surface containing the components to update. */
  readonly surfaceId: string;
  /** Component definitions to insert or update within the surface. */
  readonly components: InternalComponentPayload[];
}

/**
 * Operation to update data model values at a JSON Pointer path within a surface.
 */
export interface InternalUpdateDataModelOp {
  /** Discriminator indicating a data model update. */
  readonly type: 'updateDataModel';
  /** Identifier of the surface whose data model is being updated. */
  readonly surfaceId: string;
  /** JSON Pointer path (RFC 6901) where the value will be set. If omitted, replaces the root model. */
  readonly path?: string;
  /** Data value to write at the target path. */
  readonly value: unknown;
}

/**
 * Operation to delete a surface and tear down its associated component models and state.
 */
export interface InternalDeleteSurfaceOp {
  /** Discriminator indicating surface deletion. */
  readonly type: 'deleteSurface';
  /** Identifier of the surface to delete and dispose. */
  readonly surfaceId: string;
}

/**
 * Operation representing an agent request to execute a client-side function registered on the renderer.
 */
export interface InternalCallRendererFunctionOp {
  /** Discriminator indicating a renderer function call. */
  readonly type: 'callRendererFunction';
  /** Correlation identifier used to match this call with a subsequent response or error. */
  readonly functionCallId: string;
  /** Name of the registered catalog function to execute on the renderer. */
  readonly call: string;
  /** Protocol specification version governing this function call. */
  readonly version: ProtocolVersion;
  /** Identifier of the catalog providing the function implementation. If omitted, defaults to the surface catalog. */
  readonly catalogId?: string;
  /** Named argument map passed to the function implementation. */
  readonly args?: Record<string, unknown>;
  /** Whether the call was initiated by a direct user gesture. */
  readonly isUserActivated?: boolean;
}

/**
 * Operation containing the agent's response or error for a function previously invoked by the renderer.
 */
export interface InternalAgentFunctionResponseOp {
  /** Discriminator indicating an agent function response. */
  readonly type: 'agentFunctionResponse';
  /** Correlation identifier matching the original client-initiated function call. */
  readonly functionCallId: string;
  /** Protocol specification version associated with the response, if present. */
  readonly version?: ProtocolVersion;
  /** Return value produced by the agent function upon successful execution. */
  readonly value?: unknown;
  /** Error details if the agent function failed. */
  readonly error?: {
    /** Error code describing the failure type (e.g. `'EXECUTION_ERROR'`). */
    code: string;
    /** Human-readable explanation of why the function failed. */
    message: string;
  };
}

/**
 * Union of all normalized internal operations processed by the message pipeline.
 */
export type InternalOperation =
  | InternalCreateSurfaceOp
  | InternalUpdateComponentsOp
  | InternalUpdateDataModelOp
  | InternalDeleteSurfaceOp
  | InternalCallRendererFunctionOp
  | InternalAgentFunctionResponseOp;

/**
 * All supported internal operation type discriminator strings.
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
 * Type representing any valid internal operation type discriminator.
 */
export type InternalOperationType = (typeof INTERNAL_OPERATION_TYPES)[number];

/**
 * Determines whether a given value is a valid {@link InternalOperation}.
 *
 * @param payload The candidate value to inspect.
 * @returns `true` if the payload conforms to an internal operation structure; otherwise `false`.
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
