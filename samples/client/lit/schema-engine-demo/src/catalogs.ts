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
 * The demo's two custom v1.0 catalogs and the messages that build a surface
 * from each. This module has no DOM dependency: the Lit app adds its elements
 * to these component APIs, and the smoke script uses them as they are.
 *
 * Both catalogs have the same two components:
 *
 * - `Panel`: a `title` (DynamicString) over `children` (ChildList).
 * - `Badge`: a `label` (DynamicString), an `active` flag (DynamicBoolean)
 *   and an optional `tone` (`'neutral'` or `'accent'`).
 */

import {Catalog, fromJsonSchema, type ComponentApi, type JsonSchemaValidator} from '@a2ui/web_core';
import {ChildList, DynamicBoolean, DynamicString, component} from '@a2ui/schema-zod4/v1_0';
import * as z from 'zod';

export const ZOD_CATALOG_ID = 'https://example.com/schema-engine-demo/zod4-catalog.json';
export const JSON_CATALOG_ID = 'https://example.com/schema-engine-demo/json-catalog.json';

/** The components of the zod 4 catalog, written with `@a2ui/schema-zod4`. */
export const zodComponents = [
  {
    name: 'Panel',
    schema: component({title: DynamicString, children: ChildList}),
  },
  {
    name: 'Badge',
    schema: component({
      label: DynamicString,
      active: DynamicBoolean.default(false),
      tone: z.enum(['neutral', 'accent']).optional(),
    }),
  },
] satisfies ComponentApi[];

const ref = (name: string) => ({$ref: `common_types.json#/$defs/${name}`});

/** The components of the plain catalog, as JSON Schema documents. */
export const jsonComponentSchemas = {
  Panel: {
    type: 'object',
    properties: {title: ref('DynamicString'), children: ref('ChildList')},
    required: ['title', 'children'],
    additionalProperties: false,
  },
  Badge: {
    type: 'object',
    properties: {
      label: ref('DynamicString'),
      active: {...ref('DynamicBoolean'), default: false},
      tone: {type: 'string', enum: ['neutral', 'accent']},
    },
    required: ['label'],
    additionalProperties: false,
  },
} as const;

/** The components of the plain catalog, compiled by `validator`. */
export function jsonComponents(validator: JsonSchemaValidator): ComponentApi[] {
  return Object.entries(jsonComponentSchemas).map(([name, schema]) => ({
    name,
    schema: fromJsonSchema(schema, validator, {version: '1.0'}),
  }));
}

/**
 * Builds both catalogs. `implement` turns a component API into the entry a
 * renderer needs (the Lit app adds its element); the default keeps the API.
 */
export function createDemoCatalogs<Api extends ComponentApi = ComponentApi>(
  validator: JsonSchemaValidator,
  implement: (api: ComponentApi) => Api = api => api as Api,
): {zod: Catalog<Api>; json: Catalog<Api>} {
  return {
    zod: new Catalog<Api>(ZOD_CATALOG_ID, '1.0', zodComponents.map(implement)),
    json: new Catalog<Api>(JSON_CATALOG_ID, '1.0', jsonComponents(validator).map(implement)),
  };
}

/** The data model both surfaces start with. */
export const initialData = {status: 'Pending', ready: false};

/** The data model after the demo's update. */
export const updatedData = {status: 'Shipped', ready: true};

/** The v1.0 messages that create a surface over `catalogId`. */
export function surfaceMessages(surfaceId: string, catalogId: string, title: string) {
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId,
        catalogId,
        dataModel: initialData,
        components: [
          {id: 'root', component: 'Panel', title, children: ['status', 'ready', 'fixed']},
          {
            id: 'status',
            component: 'Badge',
            label: {'@path': '/status'},
            active: {'@path': '/ready'},
          },
          {id: 'ready', component: 'Badge', label: 'Ready to ship', active: {'@path': '/ready'}},
          {id: 'fixed', component: 'Badge', label: 'Always on', active: true, tone: 'accent'},
        ],
      },
    },
  ] as const;
}

/** The v1.0 message that moves a surface's data model to `updatedData`. */
export function updateMessages(surfaceId: string) {
  return [{version: '1.0', updateDataModel: {surfaceId, path: '/', value: updatedData}}] as const;
}

/**
 * A v1.0 message whose binding is spelled the v0.9 way, `{path}` without
 * `@`: the processor rejects it.
 */
export function invalidMessages(surfaceId: string) {
  return [
    {
      version: '1.0',
      updateComponents: {
        surfaceId,
        components: [{id: 'bad', component: 'Badge', label: {path: '/x'}}],
      },
    },
  ] as const;
}
