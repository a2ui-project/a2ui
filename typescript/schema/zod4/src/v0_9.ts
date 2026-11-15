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
 * zod 4 schemas of the A2UI v0.9 common types, for writing catalog schemas.
 * Bindings are `{path}` and calls `{call}`, as v0.9 spells them.
 *
 * Each converts, through {@link component}, {@link catalogSchema} or
 * {@link a2uiJsonSchema}, to a `$ref` into `common_types.json`, which web_core
 * reads bindings and child references from; the spec's definition is what
 * validates a message, and these validate a component's properties.
 *
 * @module
 */

import {z} from 'zod';
import {commonType} from './core.js';

export {a2uiJsonSchema, catalogSchema, component, type A2uiJsonSchemaOptions} from './core.js';

/** A component id (`ComponentId`). */
export const ComponentId = commonType('ComponentId', z.string());

/**
 * A reference to a single child component. v0.9 has no `Child` definition:
 * a child is a `ComponentId`, which this converts to.
 */
export const Child = commonType('ComponentId', z.string());

/** A static list of child ids, or a template over a data model list (`ChildList`). */
export const ChildList = commonType(
  'ChildList',
  z.union([z.array(z.string()), z.strictObject({componentId: z.string(), path: z.string()})]),
);

/** A binding to a data model value: `{path}` (`DataBinding`). */
export const DataBinding = commonType('DataBinding', z.strictObject({path: z.string()}));

/** A call of a named function: `{call}` (`FunctionCall`). */
export const FunctionCall = commonType(
  'FunctionCall',
  z.looseObject({
    call: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
    returnType: z
      .enum(['string', 'number', 'boolean', 'array', 'object', 'any', 'void'])
      .optional(),
  }),
);

/** A string, or a binding or call that yields one (`DynamicString`). */
export const DynamicString = commonType(
  'DynamicString',
  z.union([z.string(), DataBinding, FunctionCall]),
);

/** A number, or a binding or call that yields one (`DynamicNumber`). */
export const DynamicNumber = commonType(
  'DynamicNumber',
  z.union([z.number(), DataBinding, FunctionCall]),
);

/** A boolean, or a binding or call that yields one (`DynamicBoolean`). */
export const DynamicBoolean = commonType(
  'DynamicBoolean',
  z.union([z.boolean(), DataBinding, FunctionCall]),
);

/** A list of strings, or a binding or call that yields one (`DynamicStringList`). */
export const DynamicStringList = commonType(
  'DynamicStringList',
  z.union([z.array(z.string()), DataBinding, FunctionCall]),
);

/** Any value, or a binding or call that yields one (`DynamicValue`). */
export const DynamicValue = commonType(
  'DynamicValue',
  z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), DataBinding, FunctionCall]),
);

/** A server-side event or a client-side function call (`Action`). */
export const Action = commonType(
  'Action',
  z.union([
    z.strictObject({
      event: z.strictObject({
        name: z.string(),
        context: z.record(z.string(), DynamicValue).optional(),
      }),
    }),
    z.strictObject({functionCall: FunctionCall}),
  ]),
);

/** A validation check of an input component (`CheckRule`). */
export const CheckRule = commonType(
  'CheckRule',
  z.strictObject({condition: DynamicBoolean, message: z.string()}),
);

/**
 * The properties of a component that supports checks (`Checkable`): spread
 * `Checkable.shape` into a component's shape.
 */
export const Checkable = commonType('Checkable', z.object({checks: z.array(CheckRule).optional()}));

/** Attributes for assistive technologies (`AccessibilityAttributes`). */
export const AccessibilityAttributes = commonType(
  'AccessibilityAttributes',
  z.object({label: DynamicString.optional(), description: DynamicString.optional()}),
);
