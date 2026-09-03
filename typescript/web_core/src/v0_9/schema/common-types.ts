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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/v0_9/json/ via scripts/generate-zod-schemas.mjs
import {z} from 'zod';
import {markChildRef} from '../../types/child-ref-helpers.js';

export const ComponentIdSchema = markChildRef(
  z
    .string()
    .describe(
      'REF:#/$defs/ComponentId|The unique identifier for a component, used for both definitions and references within the same surface.',
    ),
  'component-id',
);
export type ComponentId = z.infer<typeof ComponentIdSchema>;

export const DataBindingSchema = z
  .object({'path': z.string().describe('A JSON Pointer path to a value in the data model.')})
  .strict()
  .describe('REF:#/$defs/DataBinding');
export type DataBinding = z.infer<typeof DataBindingSchema>;

export type DynamicValue =
  | string
  | number
  | boolean
  | any[]
  | DataBinding
  | FunctionCall
  | Record<string, any>;
export const DynamicValueSchema: z.ZodType<DynamicValue> = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    DataBindingSchema,
    z.lazy(() => FunctionCallSchema),
  ])
  .describe(
    'REF:#/$defs/DynamicValue|A value that can be a literal, a path, or a function call returning any type.',
  );

export interface FunctionCall {
  call: string;
  args?: Record<string, any>;
  returnType?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
}
export const FunctionCallSchema: z.ZodType<FunctionCall> = z
  .object({
    'call': z.string().describe('The name of the function to call.'),
    'args': z
      .record(
        z.string(),
        z.union([
          DynamicValueSchema,
          z.record(z.string(), z.any()).describe('A literal object argument (e.g. configuration).'),
        ]),
      )
      .describe('Arguments passed to the function.')
      .optional(),
    'returnType': z
      .enum(['string', 'number', 'boolean', 'array', 'object', 'any', 'void'])
      .describe('The expected return type of the function call.')
      .default('boolean'),
  })
  .describe('REF:#/$defs/FunctionCall|Invokes a named function on the client.');

export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicString|Represents a string');
export type DynamicString = z.infer<typeof DynamicStringSchema>;

export const AccessibilityAttributesSchema = z
  .object({'label': DynamicStringSchema.optional(), 'description': DynamicStringSchema.optional()})
  .describe(
    'REF:#/$defs/AccessibilityAttributes|Attributes to enhance accessibility when using assistive technologies like screen readers.',
  );
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

export const ComponentCommonSchema = z
  .object({'id': ComponentIdSchema, 'accessibility': AccessibilityAttributesSchema.optional()})
  .describe('REF:#/$defs/ComponentCommon');
export type ComponentCommon = z.infer<typeof ComponentCommonSchema>;

export const ChildListSchema = markChildRef(
  z
    .union([
      z.array(ComponentIdSchema).describe('A static list of child component IDs.'),
      z
        .object({
          'componentId': ComponentIdSchema,
          'path': z
            .string()
            .describe('The path to the list of component property objects in the data model.'),
        })
        .strict()
        .describe(
          'A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.',
        ),
    ])
    .describe('REF:#/$defs/ChildList'),
  'child-list',
);
export type ChildList = z.infer<typeof ChildListSchema>;

export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:#/$defs/DynamicNumber|Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.',
  );
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;

export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:#/$defs/DynamicBoolean|A boolean value that can be a literal, a path, or a function call returning a boolean.',
  );
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;

export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:#/$defs/DynamicStringList|Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.',
  );
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;

export const CheckRuleSchema = z
  .object({
    'condition': DynamicBooleanSchema,
    'message': z.string().describe('The error message to display if the check fails.'),
  })
  .strict()
  .describe('REF:#/$defs/CheckRule|A single validation rule applied to an input component.');
export type CheckRule = z.infer<typeof CheckRuleSchema>;

export const CheckableSchema = z
  .object({
    'checks': z
      .array(CheckRuleSchema)
      .describe(
        'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
      )
      .optional(),
  })
  .describe('REF:#/$defs/Checkable|Properties for components that support client-side checks.');
export type Checkable = z.infer<typeof CheckableSchema>;

export const ActionSchema = z
  .union([
    z
      .object({
        'event': z
          .object({
            'name': z.string().describe('The name of the action to be dispatched to the server.'),
            'context': z
              .record(z.string(), DynamicValueSchema)
              .describe(
                'A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.',
              )
              .optional(),
          })
          .strict()
          .describe('The event to dispatch to the server.'),
      })
      .strict()
      .describe('Triggers a server-side event.'),
    z
      .object({'functionCall': FunctionCallSchema})
      .strict()
      .describe('Executes a local client-side function.'),
  ])
  .describe(
    'REF:#/$defs/Action|Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.',
  );
export type Action = z.infer<typeof ActionSchema>;

export const CommonSchemas = {
  ComponentId: ComponentIdSchema,
  DataBinding: DataBindingSchema,
  DynamicValue: DynamicValueSchema,
  FunctionCall: FunctionCallSchema,
  DynamicString: DynamicStringSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
  ComponentCommon: ComponentCommonSchema,
  ChildList: ChildListSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicBoolean: DynamicBooleanSchema,
  DynamicStringList: DynamicStringListSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  Action: ActionSchema,
};

export * from './helpers.js';
