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

import {z} from 'zod';

/** Schema for a unique component identifier string. */
export const ComponentIdSchema = z
  .string()
  .describe('REF:common_types.json#/$defs/ComponentId|The unique identifier for a component.');

/** Unique component identifier string type. */
export type ComponentId = z.infer<typeof ComponentIdSchema>;

/** Schema for a unique function call identifier string. */
export const CallIdSchema = z
  .string()
  .describe('REF:common_types.json#/$defs/CallId|The unique identifier for a function call.');

/** Unique function call identifier string type. */
export type CallId = z.infer<typeof CallIdSchema>;

/** Schema for a JSON Pointer path data binding. */
export const DataBindingSchema = z
  .object({
    path: z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .strict()
  .describe(
    'REF:common_types.json#/$defs/DataBinding|A JSON Pointer path to a value in the data model.',
  );

/** JSON Pointer path data binding type. */
export type DataBinding = z.infer<typeof DataBindingSchema>;

/** Schema for invoking a named function. */
export const FunctionCallSchema = z
  .object({
    call: z.string().describe('The name of the function to call.'),
    catalogId: z
      .string()
      .optional()
      .describe('The catalog ID for this function, overriding surface-level catalogId.'),
    args: z.record(z.any()).optional().describe('Arguments passed to the function.'),
  })
  .strict()
  .describe('REF:common_types.json#/$defs/FunctionCall|Invokes a named function.');

/** Function call representation type. */
export type FunctionCall = z.infer<typeof FunctionCallSchema>;

/** Schema for dynamic values (literals, data bindings, or function calls). */
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
    'REF:common_types.json#/$defs/DynamicValue|A value that can be a literal, a path, or a function call.',
  );

/** Dynamic value type. */
export type DynamicValue = z.infer<typeof DynamicValueSchema>;

/** Schema for dynamic string values. */
export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicString|Represents a string or dynamic string binding.',
  );

/** Dynamic string type. */
export type DynamicString = z.infer<typeof DynamicStringSchema>;

/** Schema for dynamic number values. */
export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicNumber|Represents a number or dynamic number binding.',
  );

/** Dynamic number type. */
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;

/** Schema for dynamic boolean values. */
export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicBoolean|Represents a boolean or dynamic boolean binding.',
  );

/** Dynamic boolean type. */
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;

/** Schema for dynamic list of strings. */
export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicStringList|Represents a list of strings or dynamic string list binding.',
  );

/** Dynamic string list type. */
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;

/** Schema for accessibility attributes. */
export const AccessibilityAttributesSchema = z
  .object({
    label: DynamicStringSchema.optional().describe(
      'A short string used by assistive technologies.',
    ),
    description: DynamicStringSchema.optional().describe(
      'Additional information provided by assistive technologies.',
    ),
    live: z
      .enum(['off', 'polite', 'assertive'])
      .default('off')
      .optional()
      .describe('Controls screen reader announcements for dynamic updates.'),
    hidden: DynamicBooleanSchema.optional().describe(
      'Whether to hide the element and its children from assistive technologies.',
    ),
  })
  .strict()
  .describe(
    'REF:common_types.json#/$defs/AccessibilityAttributes|Attributes to enhance accessibility.',
  );

/** Accessibility attributes type. */
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

/** Schema for extension metadata. */
export const ExtensionsSchema = z
  .record(z.any())
  .describe('REF:common_types.json#/$defs/Extensions|Optional extension metadata.');

/** Extension metadata type. */
export type Extensions = z.infer<typeof ExtensionsSchema>;

/** Schema for common component properties. */
export const ComponentCommonSchema = z
  .object({
    id: ComponentIdSchema,
    catalogId: z.string().optional().describe('Overriding surface-level catalogId for component.'),
    accessibility: AccessibilityAttributesSchema.optional(),
    metadata: z
      .object({
        extensions: ExtensionsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .describe('REF:common_types.json#/$defs/ComponentCommon|Common component baseline envelope.');

/** Common component properties type. */
export type ComponentCommon = z.infer<typeof ComponentCommonSchema>;

/** Schema for a child reference. */
export const ChildSchema = ComponentIdSchema;

/** Child reference type. */
export type Child = z.infer<typeof ChildSchema>;

/** Schema for static child list or dynamic list template. */
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
      .strict()
      .describe('A template for generating a dynamic list of children.'),
  ])
  .describe(
    'REF:common_types.json#/$defs/ChildList|Static child ID array or dynamic list template.',
  );

/** Child list type. */
export type ChildList = z.infer<typeof ChildListSchema>;

/** Schema for function baseline common properties. */
export const FunctionCommonSchema = z
  .object({
    catalogId: z.string().optional().describe('The catalog ID for this function.'),
  })
  .describe('REF:common_types.json#/$defs/FunctionCommon|Common function properties.');

/** Function common properties type. */
export type FunctionCommon = z.infer<typeof FunctionCommonSchema>;

/** Schema for system function index evaluation in dynamic list templates. */
export const IndexSystemFunctionSchema = z
  .object({
    call: z.literal('@index'),
    args: z
      .object({
        offset: DynamicNumberSchema.optional().default(0),
      })
      .strict()
      .optional(),
  })
  .strict()
  .describe(
    'REF:common_types.json#/$defs/IndexSystemFunction|Returns 0-based index of current template item.',
  );

/** System index function type. */
export type IndexSystemFunction = z.infer<typeof IndexSystemFunctionSchema>;

/** Schema for dynamic validation result objects returned by validation condition functions. */
export const ValidationResultSchema = z
  .object({
    valid: z.boolean().describe('Whether the check passed.'),
    code: z.string().optional().describe('Machine-readable error code.'),
    message: z.string().optional().describe('Human-readable error message.'),
    severity: z
      .enum(['error', 'warning', 'info'])
      .default('error')
      .optional()
      .describe('Severity level of validation result.'),
  })
  .passthrough()
  .describe('Dynamic validation result object returned by validation conditions.');

/** Dynamic validation result type. */
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/** Schema for a check rule applied to an input component. */
export const CheckRuleSchema = z
  .object({
    condition: z
      .union([DataBindingSchema, FunctionCallSchema])
      .describe('Path or function call evaluating to a ValidationResult or boolean.'),
    message: z.string().optional().describe('Optional fallback error message.'),
  })
  .strict()
  .describe('REF:common_types.json#/$defs/CheckRule|A check rule for component validation.');

/** Check rule type. */
export type CheckRule = z.infer<typeof CheckRuleSchema>;

/** Schema for components supporting renderer-side checks. */
export const CheckableSchema = z
  .object({
    checks: z.array(CheckRuleSchema).optional().describe('A list of checks to perform.'),
  })
  .describe(
    'REF:common_types.json#/$defs/Checkable|Properties for components supporting renderer-side checks.',
  );

/** Checkable component properties type. */
export type Checkable = z.infer<typeof CheckableSchema>;

/** Schema for component interaction handlers (agent events or local functions). */
export const ActionSchema = z
  .union([
    z
      .object({
        event: z
          .object({
            name: z.string().describe('The name of the action.'),
            userMessage: DynamicStringSchema.optional().describe(
              'Human-readable message describing action.',
            ),
            context: z
              .record(DynamicValueSchema)
              .optional()
              .describe('Key-value pairs for action context.'),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        functionCall: FunctionCallSchema,
      })
      .strict(),
  ])
  .describe(
    'REF:common_types.json#/$defs/Action|Interaction handler defining agent event or local function.',
  );

/** Interaction handler action type. */
export type Action = z.infer<typeof ActionSchema>;

/** Schema for canonical Surface component. */
export const SurfaceSchema = z
  .object({
    component: z.literal('Surface'),
    child: z.literal('root'),
  })
  .strict()
  .describe('REF:common_types.json#/$defs/Surface|Reserved canonical container component.');

/** Canonical Surface component type. */
export type Surface = z.infer<typeof SurfaceSchema>;

/** Schema for function execution responses. */
export const FunctionResponseSchema = z
  .union([
    z
      .object({
        functionCallId: CallIdSchema,
        value: z.any().optional(),
      })
      .strict(),
    z
      .object({
        functionCallId: CallIdSchema,
        error: z
          .object({
            code: z.string(),
            message: z.string(),
          })
          .strict(),
      })
      .strict(),
  ])
  .describe('REF:common_types.json#/$defs/FunctionResponse|Return response for a function call.');

/** Function execution response type. */
export type FunctionResponse = z.infer<typeof FunctionResponseSchema>;

/** Schema for any generic A2UI component. */
export const AnyComponentSchema = z
  .object({
    component: z.string().describe('The component type name.'),
    id: ComponentIdSchema,
    weight: z.number().optional(),
  })
  .passthrough()
  .describe('Generic A2UI component definition.');

/** Generic A2UI component type. */
export type AnyComponent = z.infer<typeof AnyComponentSchema>;

/** Schema for a data model update payload. */
export const DataModelUpdateSchema = z
  .object({
    surfaceId: z.string().describe('The surface ID to update.'),
    path: z.string().optional().describe('Optional JSON Pointer path within data model.'),
    value: z.any().optional().describe('The new data value.'),
  })
  .strict()
  .describe('Payload for data model update.');

/** Data model update payload type. */
export type DataModelUpdate = z.infer<typeof DataModelUpdateSchema>;

/** Collection of common Zod schemas for v1.0. */
export const CommonSchemas = {
  ComponentId: ComponentIdSchema,
  CallId: CallIdSchema,
  DataBinding: DataBindingSchema,
  FunctionCall: FunctionCallSchema,
  DynamicValue: DynamicValueSchema,
  DynamicString: DynamicStringSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicBoolean: DynamicBooleanSchema,
  DynamicStringList: DynamicStringListSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
  Extensions: ExtensionsSchema,
  ComponentCommon: ComponentCommonSchema,
  Child: ChildSchema,
  ChildList: ChildListSchema,
  FunctionCommon: FunctionCommonSchema,
  IndexSystemFunction: IndexSystemFunctionSchema,
  ValidationResult: ValidationResultSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  Action: ActionSchema,
  Surface: SurfaceSchema,
  FunctionResponse: FunctionResponseSchema,
  AnyComponent: AnyComponentSchema,
  DataModelUpdate: DataModelUpdateSchema,
};
