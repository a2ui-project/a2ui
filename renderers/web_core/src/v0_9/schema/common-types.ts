/*
 * Copyright 2025 Google LLC
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

import {z} from 'zod';

export const DataBindingSchema = z
  .object({
    path: z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .describe(
    'REF:common_types.json#/$defs/DataBinding|A JSON Pointer path to a value in the data model.',
  );
export type DataBindingType = z.infer<typeof DataBindingSchema>;

export const FunctionCallSchema = z
  .object({
    call: z.string().describe('The name of the function to call.'),
    args: z.record(z.any()).describe('Arguments passed to the function.'),
    returnType: z
      .enum(['string', 'number', 'boolean', 'array', 'object', 'any', 'void'])
      .default('boolean'),
  })
  .describe('REF:common_types.json#/$defs/FunctionCall|Invokes a named function on the client.');
export type FunctionCallType = z.infer<typeof FunctionCallSchema>;

export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicBoolean|A boolean value that can be a literal, a path, or a function call returning a boolean.',
  );

export const DynamicStringSchema = z
  .union([
    z.string(),
    DataBindingSchema,
    // FunctionCall returning string (simplified schema for Zod, stricter in JSON Schema)
    FunctionCallSchema,
  ])
  .describe('REF:common_types.json#/$defs/DynamicString|Represents a string');

export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicNumber|Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.',
  );

export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicStringList|Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.',
  );

export const DynamicValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    DataBindingSchema,
    FunctionCallSchema,
  ])
  .describe(
    'REF:common_types.json#/$defs/DynamicValue|A value that can be a literal, a path, or a function call returning any type.',
  );

/** A JSON Pointer path to a value in the data model. */
export type DataBinding = z.infer<typeof DataBindingSchema>;
/** A function call representation. */
export type FunctionCall = z.infer<typeof FunctionCallSchema>;
/** A dynamic string that can be a literal, a data binding, or a function call. */
export type DynamicString = z.infer<typeof DynamicStringSchema>;
/** A dynamic number that can be a literal, a data binding, or a function call. */
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;
/** A dynamic boolean that can be a literal, a path, or a function call returning a boolean. */
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;
/** A dynamic list of strings that can be a literal array, a data binding, or a function call. */
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;
/** A dynamic value that can be a literal, a path, or a function call returning any type. */
export type DynamicValue = z.infer<typeof DynamicValueSchema>;

export const ComponentIdSchema = z
  .string()
  .describe('REF:common_types.json#/$defs/ComponentId|The unique identifier for a component.');
/** The unique identifier for a component. */
export type ComponentId = z.infer<typeof ComponentIdSchema>;

export const ChildListSchema = z
  .union([
    z.array(ComponentIdSchema).describe('A static list of child component IDs.'),
    z
      .object({
        componentId: ComponentIdSchema,
        path: z
          .string()
          .describe('The path to the list of component property objects in the data model.'),
      })
      .describe('A template for generating a dynamic list of children.'),
  ])
  .describe('REF:common_types.json#/$defs/ChildList');
/** A static list of child component IDs or a dynamic list template. */
export type ChildList = z.infer<typeof ChildListSchema>;

export const ActionSchema = z
  .union([
    z
      .object({
        event: z.object({
          name: z.string(),
          context: z.record(DynamicValueSchema).optional(),
        }),
      })
      .describe('Triggers a server-side event.'),
    z
      .object({
        functionCall: FunctionCallSchema,
      })
      .describe('Executes a local client-side function.'),
  ])
  .describe('REF:common_types.json#/$defs/Action');
/** Triggers a server-side event or a local client-side function. */
export type Action = z.infer<typeof ActionSchema>;

export const CheckRuleSchema = z
  .object({
    condition: DynamicBooleanSchema,
    message: z.string().describe('The error message to display if the check fails.'),
  })
  .describe(
    'REF:common_types.json#/$defs/CheckRule|A check rule consisting of a condition and an error message.',
  );
/** A check rule consisting of a condition and an error message. */
export type CheckRule = z.infer<typeof CheckRuleSchema>;

export const CheckableSchema = z
  .object({
    checks: z.array(CheckRuleSchema).optional().describe('A list of checks to perform.'),
  })
  .describe(
    'REF:common_types.json#/$defs/Checkable|Properties for components that support client-side checks.',
  );
/** An object that contains checks. */
export type Checkable = z.infer<typeof CheckableSchema>;

export const AccessibilityAttributesSchema = z
  .object({
    label: DynamicStringSchema.optional().describe(
      'REF:common_types.json#/$defs/DynamicString|A short string used by assistive technologies to convey the purpose of an element.',
    ),
    description: DynamicStringSchema.optional().describe(
      'REF:common_types.json#/$defs/DynamicString|Additional information provided by assistive technologies about an element.',
    ),
  })
  .describe(
    'REF:common_types.json#/$defs/AccessibilityAttributes|Attributes to enhance accessibility.',
  );

/** Accessibility attributes like label and description. */
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

export const AnyComponentSchema = z
  .object({
    component: z.string().describe('The type name of the component.'),
    id: ComponentIdSchema.optional(),
    weight: z.number().optional(),
  })
  .passthrough()
  .describe('A generic A2UI component definition.');

/** A generic A2UI component definition. */
export type AnyComponent = z.infer<typeof AnyComponentSchema>;

export const CommonSchemas = {
  ComponentId: ComponentIdSchema,
  ChildList: ChildListSchema,
  DataBinding: DataBindingSchema,
  DynamicValue: DynamicValueSchema,
  DynamicString: DynamicStringSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicBoolean: DynamicBooleanSchema,
  DynamicStringList: DynamicStringListSchema,
  FunctionCall: FunctionCallSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  Action: ActionSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
  AnyComponent: AnyComponentSchema,
};
