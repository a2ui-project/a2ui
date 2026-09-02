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
import {
  type ChildRefKind,
  type RefSchemaOptions,
  markChildRef,
  childRefKindOf,
} from './child-ref-helpers.js';

export {type ChildRefKind, type RefSchemaOptions, markChildRef, childRefKindOf};

export const ComponentIdSchema = markChildRef(
  z
    .string()
    .describe('REF:common_types.json#/$defs/ComponentId|The unique identifier for a component.'),
  'component-id',
);
/** The unique identifier for a component, used for both definitions and references within the same surface. */
export type ComponentId = z.infer<typeof ComponentIdSchema>;

export const DataBindingSchema = z
  .object({
    'path': z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .describe(
    'REF:common_types.json#/$defs/DataBinding|A JSON Pointer path to a value in the data model.',
  );
export type DataBinding = z.infer<typeof DataBindingSchema>;

export type DataBindingType = DataBinding;

export const FunctionCallSchema = z
  .object({
    'call': z.string().describe('The name of the function to call.'),
    'catalogId': z.string().optional().describe('The ID of the catalog containing the function.'),
    'args': z.record(z.any()).optional().describe('Arguments passed to the function.'),
    'returnType': z
      .enum(['string', 'number', 'boolean', 'array', 'object', 'validationResult', 'any', 'void'])
      .optional(),
  })
  .describe('REF:common_types.json#/$defs/FunctionCall|Invokes a named function on the client.');
/** Invokes a named function. */
export type FunctionCall = z.infer<typeof FunctionCallSchema>;

export type FunctionCallType = FunctionCall;

export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:common_types.json#/$defs/DynamicString|Represents a dynamic string value.');
/** Represents a string */
export type DynamicString = z.infer<typeof DynamicStringSchema>;

export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicBoolean|A boolean value that can be a literal, a path, or a function call returning a boolean.',
  );
/** A boolean value that can be a literal, a path, or a function call returning a boolean. */
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;

export const AccessibilityAttributesSchema = z
  .object({
    'label': DynamicStringSchema.optional().describe(
      'A short string used by assistive technologies to convey the purpose of an element.',
    ),
    'description': DynamicStringSchema.optional().describe(
      'Additional information provided by assistive technologies about an element.',
    ),
    'live': z
      .enum(['off', 'polite', 'assertive'])
      .describe(
        "Controls screen reader announcements for dynamic updates (WAI-ARIA aria-live). 'polite' waits for user pause; 'assertive' interrupts immediately for alerts.",
      )
      .default('off')
      .optional(),
    'hidden': DynamicBooleanSchema.optional().describe(
      'Controls whether assistive technologies hide the element.',
    ),
  })
  .describe(
    'REF:common_types.json#/$defs/AccessibilityAttributes|Attributes to enhance accessibility.',
  );
/** Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding. */
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

export const ExtensionsSchema = z
  .record(z.string(), z.any())
  .describe(
    "Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.",
  );
/** Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions. */
export type Extensions = z.infer<typeof ExtensionsSchema>;

export const ComponentCommonSchema = z.object({
  'id': ComponentIdSchema,
  'accessibility': AccessibilityAttributesSchema.optional(),
  'catalogId': z
    .string()
    .describe('The catalog ID for this component, overriding any surface-level default catalogId.')
    .optional(),
  'metadata': z
    .object({
      'extensions': ExtensionsSchema.optional(),
    })
    .strict()
    .describe('Optional component-level metadata for vendor extensions.')
    .optional(),
});
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
export type ChildList = z.infer<typeof ChildListSchema>;

export const DynamicValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    z.record(z.string(), z.any()).refine(obj => !obj || (!('path' in obj) && !('call' in obj))),
    DataBindingSchema,
    FunctionCallSchema,
  ])
  .describe(
    'REF:common_types.json#/$defs/DynamicValue|A value that can be a literal, a path, or a function call returning any type.',
  );
/** A value that can be a literal, a path, or a function call returning any type. */
export type DynamicValue = z.infer<typeof DynamicValueSchema>;

export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicNumber|Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.',
  );
/** Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number. */
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;

export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe(
    'REF:common_types.json#/$defs/DynamicStringList|Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.',
  );
/** Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array. */
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;

export const CheckRuleSchema = z
  .object({
    'condition': DynamicBooleanSchema,
    'message': z.string().describe('The error message to display if the check fails.'),
  })
  .describe(
    'REF:common_types.json#/$defs/CheckRule|A check rule consisting of a condition and an error message.',
  );
/** A single validation check rule applied to an input component. The condition function or path evaluates to a structured validation result object. */
export type CheckRule = z.infer<typeof CheckRuleSchema>;

export const CheckableSchema = z
  .object({
    'checks': z.array(CheckRuleSchema).optional().describe('A list of checks to perform.'),
    'isValid': z.boolean().optional().describe('Whether the checks currently pass.'),
    'validationErrors': z
      .array(z.string())
      .optional()
      .describe('Current validation error messages.'),
  })
  .describe(
    'REF:common_types.json#/$defs/Checkable|Properties for components that support client-side checks.',
  );
/** Properties for components that support renderer-side checks. */
export type Checkable = z.infer<typeof CheckableSchema>;

export const ActionSchema = z
  .union([
    z
      .object({
        'event': z.object({
          'name': z.string(),
          'context': z.record(DynamicValueSchema).optional(),
        }),
      })
      .describe('Triggers a server-side event.'),
    z
      .object({
        'functionCall': FunctionCallSchema,
      })
      .describe('Executes a local client-side function.'),
  ])
  .describe(
    'REF:common_types.json#/$defs/Action|Triggers a server-side event or a local client-side function.',
  );
/** Defines an interaction handler that can either trigger an agent-side event or execute a local renderer-side function. */
export type Action = z.infer<typeof ActionSchema>;

export const CallIdSchema = z.string().describe('The unique identifier for a function call.');
/** The unique identifier for a function call. */
export type CallId = z.infer<typeof CallIdSchema>;

export const ChildSchema = ComponentIdSchema;
/** A reference to a single child component ID. */
export type Child = z.infer<typeof ChildSchema>;

export const FunctionCommonSchema = z.object({
  'catalogId': z
    .string()
    .describe('The catalog ID for this function, overriding any surface-level default catalogId.')
    .optional(),
});
export type FunctionCommon = z.infer<typeof FunctionCommonSchema>;

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
    'Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context.',
  );
/** Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context. */
export type IndexSystemFunction = z.infer<typeof IndexSystemFunctionSchema>;

export const SurfaceSchema = z
  .object({
    'component': z.literal('Surface').optional(),
    'child': z.literal('root').optional(),
  })
  .strict()
  .describe(
    "The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has 'child': 'root'.",
  );
/** The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has 'child': 'root'. */
export type Surface = z.infer<typeof SurfaceSchema>;

export const FunctionResponseSchema = z
  .union([z.any(), z.any()])
  .describe('The return response matching a callAgentFunction or callRendererFunction invocation.');
/** The return response matching a callAgentFunction or callRendererFunction invocation. */
export type FunctionResponse = z.infer<typeof FunctionResponseSchema>;

/**
 * Creates or customizes a ComponentId schema without losing its reference pointer metadata.
 *
 * @param options Configuration options including custom description.
 * @returns The configured ComponentId schema.
 */
export function componentId(options: RefSchemaOptions = {}): typeof ComponentIdSchema {
  if (options.description === undefined) {
    return ComponentIdSchema;
  }
  return ComponentIdSchema.describe(
    `REF:common_types.json#/$defs/ComponentId|${options.description}`,
  );
}

/**
 * Creates or customizes a ChildList schema without losing its reference pointer metadata.
 *
 * @param options Configuration options including custom description.
 * @returns The configured ChildList schema.
 */
export function childList(options: RefSchemaOptions = {}): typeof ChildListSchema {
  if (options.description === undefined) {
    return ChildListSchema;
  }
  return ChildListSchema.describe(`REF:common_types.json#/$defs/ChildList|${options.description}`);
}

/**
 * Generic component definition payload schema.
 */
export const AnyComponentSchema = z
  .object({
    'component': z.string().describe('The type name of the component.'),
    'id': ComponentIdSchema.optional(),
    'weight': z.number().optional(),
  })
  .passthrough()
  .describe('A generic A2UI component definition.');

/** Generic component definition payload. */
export type AnyComponent = z.infer<typeof AnyComponentSchema>;

/**
 * Registry of reusable common schema definitions across A2UI catalogs and protocols.
 */
export const CommonSchemas = {
  ComponentId: ComponentIdSchema,
  DataBinding: DataBindingSchema,
  FunctionCall: FunctionCallSchema,
  DynamicString: DynamicStringSchema,
  DynamicBoolean: DynamicBooleanSchema,
  AccessibilityAttributes: AccessibilityAttributesSchema,
  Extensions: ExtensionsSchema,
  ComponentCommon: ComponentCommonSchema,
  ChildList: ChildListSchema,
  DynamicValue: DynamicValueSchema,
  DynamicNumber: DynamicNumberSchema,
  DynamicStringList: DynamicStringListSchema,
  CheckRule: CheckRuleSchema,
  Checkable: CheckableSchema,
  Action: ActionSchema,
  CallId: CallIdSchema,
  Child: ChildSchema,
  FunctionCommon: FunctionCommonSchema,
  IndexSystemFunction: IndexSystemFunctionSchema,
  Surface: SurfaceSchema,
  FunctionResponse: FunctionResponseSchema,
  AnyComponent: AnyComponentSchema,
};
