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

/** A2UI v1.0 message and component builders used by the card composer. */

import {INBOX_CATALOG_ID} from '../catalog/catalog_id.js';

/** A component in an `updateComponents` message. */
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

/** A surface's components and initial data model. */
export interface SurfaceView {
  readonly surfaceId: string;
  /** Shares the data model with the model after user edits. */
  readonly sendDataModel: boolean;
  readonly components: readonly A2uiComponent[];
  readonly dataModel: Record<string, unknown>;
}

/** Binds a property to a data model path (absolute, or relative inside a template). */
export function bind(path: string): DataBinding {
  return {'@path': path};
}

/** Calls a catalog function. */
export function call(name: string, args: Record<string, unknown>): FunctionCall {
  return {'@call': name, args};
}

/** `formatString` over a server-side template. Never pass untrusted text as `template`. */
export function format(template: string): FunctionCall {
  return call('formatString', {value: template});
}

/** An action that sends an event named `name` to the server with `context`. */
export function event(name: string, context: Record<string, unknown> = {}) {
  return {event: {name, context}};
}

/** Creates a component. */
export function component(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
): A2uiComponent {
  return {id, component: type, ...properties};
}

/** A `Text`; `caption` for secondary text. */
export function text(
  id: string,
  value: string | DataBinding | FunctionCall,
  variant?: 'caption' | 'body',
): A2uiComponent {
  return component(id, 'Text', variant ? {text: value, variant} : {text: value});
}

/** A `Button` with a `Text` child, returned with the child. */
export function button(
  id: string,
  label: string | DataBinding | FunctionCall,
  action: unknown,
  options: {variant?: 'default' | 'primary' | 'borderless'; checks?: readonly unknown[]} = {},
): A2uiComponent[] {
  return [
    component(id, 'Button', {
      child: `${id}_label`,
      action,
      ...(options.variant ? {variant: options.variant} : {}),
      ...(options.checks ? {'@checks': options.checks} : {}),
    }),
    text(`${id}_label`, label),
  ];
}

/** A `ChoicePicker` option list. */
export function options(entries: ReadonlyArray<readonly [value: string, label: string]>) {
  return entries.map(([value, label]) => ({label, value}));
}

/** Messages that create a surface and fill it. */
export function createSurfaceMessages(view: SurfaceView): A2uiMessage[] {
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId: view.surfaceId,
        catalogId: INBOX_CATALOG_ID,
        ...(view.sendDataModel ? {sendDataModel: true} : {}),
      },
    },
    {version: '1.0', updateComponents: {surfaceId: view.surfaceId, components: view.components}},
    {version: '1.0', updateDataModel: {surfaceId: view.surfaceId, value: view.dataModel}},
  ];
}

/** Replaces or adds components of an existing surface. */
export function updateComponents(
  surfaceId: string,
  components: readonly A2uiComponent[],
): A2uiMessage {
  return {version: '1.0', updateComponents: {surfaceId, components}};
}

/** Sets one data model path (or the whole model without `path`). */
export function updateData(
  surfaceId: string,
  path: string | undefined,
  value: unknown,
): A2uiMessage {
  return {
    version: '1.0',
    updateDataModel: path === undefined ? {surfaceId, value} : {surfaceId, path, value},
  };
}

/** Size of a value as JSON, in bytes. */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
