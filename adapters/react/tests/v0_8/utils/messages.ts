/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type * as Types from '@a2ui/web_core/types/types';

/**
 * Create a surface update message with components.
 */
export function createSurfaceUpdate(
  components: Array<{id: string; component: Record<string, unknown>}>,
  surfaceId = '@default',
): Types.ServerToClientMessage {
  return {
    surfaceUpdate: {
      surfaceId,
      components: components.map(c => ({
        id: c.id,
        component: c.component,
      })),
    },
  } as Types.ServerToClientMessage;
}

/**
 * Create a begin rendering message.
 */
export function createBeginRendering(
  rootId: string,
  surfaceId = '@default',
): Types.ServerToClientMessage {
  return {
    beginRendering: {
      root: rootId,
      surfaceId,
    },
  } as Types.ServerToClientMessage;
}

/**
 * Create messages for a simple component render.
 */
export function createSimpleMessages(
  id: string,
  componentType: string,
  props: Record<string, unknown>,
  surfaceId = '@default',
): Types.ServerToClientMessage[] {
  return [
    createSurfaceUpdate([{id, component: {[componentType]: props}}], surfaceId),
    createBeginRendering(id, surfaceId),
  ];
}

/**
 * Create a dataModelUpdate message.
 * Per A2UI spec: Updates application state independently of UI structure.
 */
export function createDataModelUpdate(
  contents: Array<{
    key: string;
    valueString?: string;
    valueNumber?: number;
    valueBoolean?: boolean;
    valueMap?: unknown[];
  }>,
  surfaceId = '@default',
  path?: string,
): Types.ServerToClientMessage {
  return {
    dataModelUpdate: {
      surfaceId,
      path,
      contents,
    },
  } as Types.ServerToClientMessage;
}

/**
 * Create a deleteSurface message.
 * Per A2UI spec: Removes a UI surface and associated content.
 */
export function createDeleteSurface(surfaceId: string): Types.ServerToClientMessage {
  return {
    deleteSurface: {
      surfaceId,
    },
  } as Types.ServerToClientMessage;
}

/**
 * Create a dataModelUpdate message with proper A2UI spec format.
 * Uses valueString for JSON-serializable values.
 */
export function createDataModelUpdateSpec(
  contents: Array<{key: string; valueString?: string; valueMap?: unknown[]}>,
  surfaceId = '@default',
  path = '/',
): Types.ServerToClientMessage {
  return {
    dataModelUpdate: {
      surfaceId,
      path,
      contents,
    },
  } as Types.ServerToClientMessage;
}
