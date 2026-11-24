/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** A2UI v1.0 message and component builders for Day & Trip Studio. */

import {TRIP_CATALOG_ID} from '../catalog/catalog_id.js';

export interface A2uiComponent {
  readonly id: string;
  readonly component: string;
  readonly [property: string]: unknown;
}

export interface DataBinding {
  readonly '@path': string;
}

export interface FunctionCall {
  readonly '@call': string;
  readonly args: Record<string, unknown>;
}

export type A2uiMessage =
  | {
      readonly version: '1.0';
      readonly createSurface: {
        readonly surfaceId: string;
        readonly catalogId: string;
        readonly sendDataModel?: boolean;
      };
    }
  | {
      readonly version: '1.0';
      readonly updateComponents: {
        readonly surfaceId: string;
        readonly components: readonly A2uiComponent[];
      };
    }
  | {
      readonly version: '1.0';
      readonly deleteSurface: {readonly surfaceId: string};
    }
  | {
      readonly version: '1.0';
      readonly updateDataModel: {
        readonly surfaceId: string;
        readonly path?: string;
        readonly value: unknown;
      };
    };

export interface SurfaceView {
  readonly surfaceId: string;
  readonly sendDataModel: boolean;
  readonly components: readonly A2uiComponent[];
  readonly dataModel: Record<string, unknown>;
}

export function bind(pointer: string): DataBinding {
  return {'@path': pointer};
}

export function call(name: string, args: Record<string, unknown>): FunctionCall {
  return {'@call': name, args};
}

export function event(name: string, context: Record<string, unknown> = {}) {
  return {event: {name, context}};
}

export function component(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
): A2uiComponent {
  return {id, component: type, ...properties};
}

export function createSurfaceMessages(view: SurfaceView): A2uiMessage[] {
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId: view.surfaceId,
        catalogId: TRIP_CATALOG_ID,
        ...(view.sendDataModel ? {sendDataModel: true} : {}),
      },
    },
    {version: '1.0', updateComponents: {surfaceId: view.surfaceId, components: view.components}},
    {version: '1.0', updateDataModel: {surfaceId: view.surfaceId, value: view.dataModel}},
  ];
}

export function updateData(
  surfaceId: string,
  pointer: string | undefined,
  value: unknown,
): A2uiMessage {
  return {
    version: '1.0',
    updateDataModel: pointer === undefined ? {surfaceId, value} : {surfaceId, path: pointer, value},
  };
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
