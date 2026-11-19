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

/** A2UI v1.0 message shapes the composers produce, and helpers to build them. */

import {SQL_CATALOG_ID} from '../catalog/catalog_id.js';

/** A component instance of the sample catalog. */
export interface A2uiComponent {
  readonly id: string;
  readonly component: string;
  readonly [property: string]: unknown;
}

/** A data binding to a JSON Pointer in the surface data model. */
export interface DataBinding {
  readonly '@path': string;
}

/** An A2UI v1.0 `createSurface` message. */
export interface CreateSurfaceMessage {
  readonly version: '1.0';
  readonly createSurface: {
    readonly surfaceId: string;
    readonly catalogId: string;
    readonly sendDataModel?: boolean;
  };
}

/** An A2UI v1.0 `updateComponents` message. */
export interface UpdateComponentsMessage {
  readonly version: '1.0';
  readonly updateComponents: {
    readonly surfaceId: string;
    readonly components: readonly A2uiComponent[];
  };
}

/** An A2UI v1.0 `updateDataModel` message: replaces the whole data model, or the value at `path`. */
export interface UpdateDataModelMessage {
  readonly version: '1.0';
  readonly updateDataModel: {
    readonly surfaceId: string;
    readonly path?: string;
    readonly value: unknown;
  };
}

/** A message the composers produce. */
export type A2uiMessage = CreateSurfaceMessage | UpdateComponentsMessage | UpdateDataModelMessage;

/** A composed view: a component tree with `root` and the data model it binds to. */
export interface A2uiView {
  readonly components: readonly A2uiComponent[];
  readonly dataModel: Record<string, unknown>;
}

/** Returns a binding to `path` in the data model. */
export function bind(path: string): DataBinding {
  return {'@path': path};
}

/**
 * Returns the messages that create a surface and render `view` on it. The
 * surface sets `sendDataModel`, so when the user selects a table row the app
 * shares the surface's data model, with the row at `/selected`, with the host
 * model.
 */
export function createSurfaceMessages(surfaceId: string, view: A2uiView): A2uiMessage[] {
  return [
    {version: '1.0', createSurface: {surfaceId, catalogId: SQL_CATALOG_ID, sendDataModel: true}},
    ...updateSurfaceMessages(surfaceId, view),
  ];
}

/**
 * Data model entries a refresh leaves alone: the title and query the view was
 * composed with, and the chart spec `explain`'s model designed.
 */
const KEPT_ON_DATA_REFRESH = new Set(['title', 'query', 'chart']);

/**
 * Returns the messages that update the data of an existing surface in place,
 * keeping its components: one `updateDataModel` per top-level entry of
 * `view.dataModel` (rows, columns, footer, KPI values, selection), except the
 * ones in {@link KEPT_ON_DATA_REFRESH}.
 */
export function updateSurfaceDataMessages(surfaceId: string, view: A2uiView): A2uiMessage[] {
  return Object.entries(view.dataModel)
    .filter(([key]) => !KEPT_ON_DATA_REFRESH.has(key))
    .map(([key, value]) => ({
      version: '1.0',
      updateDataModel: {surfaceId, path: `/${key}`, value},
    }));
}

/** Returns the messages that replace the components and data model of an existing surface. */
export function updateSurfaceMessages(surfaceId: string, view: A2uiView): A2uiMessage[] {
  return [
    {version: '1.0', updateComponents: {surfaceId, components: view.components}},
    {version: '1.0', updateDataModel: {surfaceId, value: view.dataModel}},
  ];
}
