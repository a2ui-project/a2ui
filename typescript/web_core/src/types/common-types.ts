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
// Generated from specification/*/json/common_types.json via scripts/generate-superset-common-types.mjs

/**
 * @fileoverview Shared runtime types and helper schemas for A2UI rendering
 * engines.
 *
 * Defines unversioned, internal types, schemas, and helper utilities consumed
 * by shared runtime modules (such as GenericBinder, DataContext,
 * ExpressionParser, and SchemaLoader).
 *
 * This module represents the runtime superset of the modern protocol lineage
 * (v0.9 and above), aligned with the most recent dynamic value evaluation
 * model. Version-isolated wire validation and catalog schemas are maintained
 * separately in src/v<version>/ directories, e.g. src/v1_0/.
 */
import {z} from 'zod';
import {markChildRef} from './child-ref-helpers.js';

export const ComponentIdSchema = markChildRef(
  z
    .string()
    .describe(
      'REF:common_types.json#/$defs/ComponentId|The unique identifier for a component, used for both definitions and references within the same surface.',
    ),
  'component-id',
);
/** REF:common_types.json#/$defs/ComponentId|The unique identifier for a component, used for both definitions and references within the same surface. */
export type ComponentId = z.infer<typeof ComponentIdSchema>;

export const DataBindingSchema = z
  .object({
    'path': z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .describe('REF:common_types.json#/$defs/DataBinding');
/** REF:common_types.json#/$defs/DataBinding */
export type DataBinding = z.infer<typeof DataBindingSchema>;

export type DataBindingType = DataBinding;

export const DynamicNumberSchema: z.ZodType<any> = z
  .union([z.number(), DataBindingSchema, z.lazy(() => FunctionCallSchema)])
  .describe(
    'REF:common_types.json#/$defs/DynamicNumber|Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.',
  );
/** REF:common_types.json#/$defs/DynamicNumber|Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number. */
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;

export const IndexSystemFunctionSchema = z
  .object({
    'call': z.literal('@index'),
    'args': z
      .object({
        'offset': DynamicNumberSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .describe(
    'REF:common_types.json#/$defs/IndexSystemFunction|Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context.',
  );
/** REF:common_types.json#/$defs/IndexSystemFunction|Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context. */
export type IndexSystemFunction = z.infer<typeof IndexSystemFunctionSchema>;

export const FunctionCallSchema: z.ZodType<any> = z
  .union([z.record(z.string(), z.any()), IndexSystemFunctionSchema])
  .describe('REF:common_types.json#/$defs/FunctionCall|Invokes a named function.');
/** REF:common_types.json#/$defs/FunctionCall|Invokes a named function. */
export type FunctionCall = z.infer<typeof FunctionCallSchema>;

export type FunctionCallType = FunctionCall;

export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:common_types.json#/$defs/DynamicString|Represents a string');
/** REF:common_types.json#/$defs/DynamicString|Represents a string */
export type DynamicString = z.infer<typeof DynamicStringSchema>;

export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicBoolean|A boolean value that can be a literal, a path, or a function call returning a boolean.',
  );
/** REF:common_types.json#/$defs/DynamicBoolean|A boolean value that can be a literal, a path, or a function call returning a boolean. */
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;

export const AccessibilityAttributesSchema = z
  .object({
    'label': DynamicStringSchema.optional(),
    'description': DynamicStringSchema.optional(),
    'live': z
      .enum(['off', 'polite', 'assertive'])
      .default('off')
      .describe(
        "Controls screen reader announcements for dynamic updates (WAI-ARIA aria-live). 'polite' waits for user pause; 'assertive' interrupts immediately for alerts.",
      )
      .optional(),
    'hidden': DynamicBooleanSchema.optional(),
  })
  .describe(
    'REF:common_types.json#/$defs/AccessibilityAttributes|Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding.',
  );
/** REF:common_types.json#/$defs/AccessibilityAttributes|Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding. */
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

export const ExtensionsSchema = z
  .record(z.string(), z.any())
  .describe(
    "Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.",
  );
/** REF:common_types.json#/$defs/Extensions|Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with \'a2ui_\' are reserved for official extensions. */
export type Extensions = z.infer<typeof ExtensionsSchema>;

export const ComponentCommonSchema = z
  .object({
    'id': ComponentIdSchema,
    'accessibility': AccessibilityAttributesSchema.optional(),
    'catalogId': z
      .string()
      .describe(
        'The catalog ID for this component, overriding any surface-level default catalogId.',
      )
      .optional(),
    'metadata': z
      .object({
        'extensions': ExtensionsSchema.optional(),
      })
      .strict()
      .describe('Optional component-level metadata for vendor extensions.')
      .optional(),
  })
  .describe('REF:common_types.json#/$defs/ComponentCommon');
/** REF:common_types.json#/$defs/ComponentCommon */
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
        .describe('A template for generating a dynamic list of children.'),
    ])
    .describe('REF:common_types.json#/$defs/ChildList'),
  'child-list',
);
/** REF:common_types.json#/$defs/ChildList */
export type ChildList = z.infer<typeof ChildListSchema>;

export const DynamicValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    DataBindingSchema,
    FunctionCallSchema,
    z.record(z.string(), z.any()).refine(obj => !obj || (!('path' in obj) && !('call' in obj))),
  ])
  .describe(
    'REF:common_types.json#/$defs/DynamicValue|A value that can be a literal, a path, or a function call returning any type.',
  );
/** REF:common_types.json#/$defs/DynamicValue|A value that can be a literal, a path, or a function call returning any type. */
export type DynamicValue = z.infer<typeof DynamicValueSchema>;

export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicStringList|Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.',
  );
/** REF:common_types.json#/$defs/DynamicStringList|Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array. */
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;

export const CheckRuleSchema = z
  .object({
    'condition': z
      .union([DynamicBooleanSchema, DataBindingSchema, FunctionCallSchema])
      .describe('Path or function call evaluating to a structured validation result object.'),
    'message': z.string().describe('Optional fallback error message.').optional(),
  })
  .describe(
    'REF:common_types.json#/$defs/CheckRule|A single validation check rule applied to an input component. The condition function or path evaluates to a structured validation result object.',
  );
/** REF:common_types.json#/$defs/CheckRule|A single validation check rule applied to an input component. The condition function or path evaluates to a structured validation result object. */
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
  .describe(
    'REF:common_types.json#/$defs/Checkable|Properties for components that support renderer-side checks.',
  );
/** REF:common_types.json#/$defs/Checkable|Properties for components that support renderer-side checks. */
export type Checkable = z.infer<typeof CheckableSchema>;

export const ActionSchema = z
  .union([
    z
      .object({
        'event': z
          .object({
            'name': z.string().describe('The name of the action to be dispatched to the server.'),
            'context': z
              .record(z.string(), z.any())
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
      .object({
        'functionCall': FunctionCallSchema,
      })
      .strict()
      .describe('Executes a local client-side function.'),
    z
      .object({
        'event': z
          .object({
            'name': z.string().describe('The name of the action to be dispatched to the agent.'),
            'userMessage': DynamicStringSchema.optional(),
            'context': z
              .record(z.string(), z.any())
              .describe(
                'A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.',
              )
              .optional(),
          })
          .strict()
          .describe('The event to dispatch to the agent.'),
      })
      .strict()
      .describe('Triggers an agent-side event.'),
    z
      .object({
        'functionCall': FunctionCallSchema,
      })
      .strict()
      .describe('Executes a renderer or agent-side function.'),
  ])
  .describe(
    'REF:common_types.json#/$defs/Action|Defines an interaction handler that can either trigger an agent-side event or execute a local renderer-side function.',
  );
/** REF:common_types.json#/$defs/Action|Defines an interaction handler that can either trigger an agent-side event or execute a local renderer-side function. */
export type Action = z.infer<typeof ActionSchema>;

export const CallIdSchema = z
  .string()
  .describe('REF:common_types.json#/$defs/CallId|The unique identifier for a function call.');
/** REF:common_types.json#/$defs/CallId|The unique identifier for a function call. */
export type CallId = z.infer<typeof CallIdSchema>;

export const ChildSchema = ComponentIdSchema;
/** REF:common_types.json#/$defs/Child|A reference to a single child component ID. */
export type Child = z.infer<typeof ChildSchema>;

export const FunctionCommonSchema = z
  .object({
    'catalogId': z
      .string()
      .describe('The catalog ID for this function, overriding any surface-level default catalogId.')
      .optional(),
  })
  .describe('REF:common_types.json#/$defs/FunctionCommon');
/** REF:common_types.json#/$defs/FunctionCommon */
export type FunctionCommon = z.infer<typeof FunctionCommonSchema>;

export const SurfaceSchema = z
  .object({
    'component': z.literal('Surface').optional(),
    'child': z.literal('root').optional(),
  })
  .strict()
  .describe(
    "REF:common_types.json#/$defs/Surface|The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has \\'child\\': \\'root\\'.",
  );
/** REF:common_types.json#/$defs/Surface|The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has \'child\': \'root\'. */
export type Surface = z.infer<typeof SurfaceSchema>;

export const FunctionResponseSchema = z
  .union([z.any(), z.any()])
  .describe(
    'REF:common_types.json#/$defs/FunctionResponse|The return response matching a callAgentFunction or callRendererFunction invocation.',
  );
/** REF:common_types.json#/$defs/FunctionResponse|The return response matching a callAgentFunction or callRendererFunction invocation. */
export type FunctionResponse = z.infer<typeof FunctionResponseSchema>;

/**
 * Registry of reusable common schema definitions across A2UI catalogs and protocols.
 */
export const CommonSchemas = {
  ComponentId: ComponentIdSchema,
  DataBinding: DataBindingSchema,
  DynamicNumber: DynamicNumberSchema,
  IndexSystemFunction: IndexSystemFunctionSchema,
  FunctionCall: FunctionCallSchema,
  DynamicString: DynamicStringSchema,
  DynamicBoolean: DynamicBooleanSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
  Extensions: ExtensionsSchema,
  ComponentCommon: ComponentCommonSchema,
  ChildList: ChildListSchema,
  DynamicValue: DynamicValueSchema,
  DynamicStringList: DynamicStringListSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  Action: ActionSchema,
  CallId: CallIdSchema,
  Child: ChildSchema,
  FunctionCommon: FunctionCommonSchema,
  Surface: SurfaceSchema,
  FunctionResponse: FunctionResponseSchema,
};

export * from './helpers.js';
