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

/** The unique identifier for a component. */
export type ChildRefKind = 'component-id' | 'child-list';

function markChildRef<T extends z.ZodTypeAny>(schema: T, ref: ChildRefKind): T {
  (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef = ref;
  return schema;
}

export function childRefKindOf(schema: z.ZodTypeAny): ChildRefKind | undefined {
  return (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef;
}

export interface RefSchemaOptions {
  readonly description?: string;
}

export const TemplateChildListSchema = z
  .object({
    'componentId': z.lazy(() => ComponentIdSchema),
    'path': z
      .string()
      .describe('The path to the list of component property objects in the data model.'),
  })
  .describe('REF:#/$defs/TemplateChildList');

export const ComponentIdSchema = markChildRef(
  z.string().describe('REF:#/$defs/ComponentId'),
  'component-id',
);
export type ComponentId = z.infer<typeof ComponentIdSchema>;

export const DataBindingSchema = z
  .object({
    'path': z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .describe('REF:#/$defs/DataBinding');
export type DataBinding = z.infer<typeof DataBindingSchema>;

export const DynamicValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    DataBindingSchema,
    z.lazy(() => FunctionCallSchema),
  ])
  .describe('REF:#/$defs/DynamicValue');
export type DynamicValue = z.infer<typeof DynamicValueSchema>;

export const FunctionCallSchema = z
  .object({
    'call': z.string().describe('The name of the function to call.'),
    'args': z.record(z.any()).describe('Arguments passed to the function.').optional(),
    'catalogId': z
      .string()
      .describe('The catalog ID for this function, overriding any surface-level default catalogId.')
      .optional(),
  })
  .describe('REF:#/$defs/FunctionCall');
export type FunctionCall = z.infer<typeof FunctionCallSchema>;

export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicString');
export type DynamicString = z.infer<typeof DynamicStringSchema>;

export const AccessibilityAttributesSchema = z
  .object({
    'label': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|A short string, typically 1 to 3 words, used by assistive technologies to convey the purpose or intent of an element. For example, an input field might have an accessible label of 'User ID' or a button might be labeled 'Submit'.",
    ).optional(),
    'description': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|Additional information provided by assistive technologies about an element such as instructions, format requirements, or result of an action. For example, a mute button might have a label of 'Mute' and a description of 'Silences notifications about this conversation'.",
    ).optional(),
  })
  .describe('REF:#/$defs/AccessibilityAttributes');
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

export const ComponentCommonSchema = z.object({
  'id': ComponentIdSchema,
  'accessibility': AccessibilityAttributesSchema.optional(),
});
export type ComponentCommon = z.infer<typeof ComponentCommonSchema>;

export const ChildListSchema = markChildRef(
  z.union([z.array(ComponentIdSchema), TemplateChildListSchema]),
  'child-list',
);
export type ChildList = z.infer<typeof ChildListSchema>;

export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicNumber');
export type DynamicNumber = z.infer<typeof DynamicNumberSchema>;

export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicBoolean');
export type DynamicBoolean = z.infer<typeof DynamicBooleanSchema>;

export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicStringList');
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;

export const CheckRuleSchema = z
  .object({
    'condition': DynamicBooleanSchema,
    'message': z.string().describe('The error message to display if the check fails.'),
  })
  .strict()
  .describe('A single validation rule applied to an input component.');
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
  .describe('Properties for components that support client-side checks.');
export type Checkable = z.infer<typeof CheckableSchema>;

export const ActionEventSchema = z
  .object({
    'name': z.string().describe('The name of the action to be dispatched to the server.'),
    'context': z
      .record(DynamicValueSchema)
      .describe(
        'A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.',
      )
      .optional(),
  })
  .describe('REF:#/$defs/ActionEvent');

export const ActionEventWrapperSchema = z
  .object({
    'event': ActionEventSchema,
  })
  .describe('REF:#/$defs/ActionEventWrapper');

export const ActionFunctionCallWrapperSchema = z
  .object({
    'functionCall': FunctionCallSchema,
  })
  .describe('REF:#/$defs/ActionFunctionCallWrapper');

export const ActionSchema = z
  .union([ActionEventWrapperSchema, ActionFunctionCallWrapperSchema])
  .describe('REF:#/$defs/Action');
export type Action = z.infer<typeof ActionSchema>;

export function componentId(options: RefSchemaOptions = {}): typeof ComponentIdSchema {
  if (options.description === undefined) {
    return ComponentIdSchema;
  }
  return ComponentIdSchema.describe(`REF:#/$defs/ComponentId|${options.description}`);
}

export function dynamicString(description?: string) {
  return description
    ? DynamicStringSchema.describe(`REF:#/$defs/DynamicString|${description}`)
    : DynamicStringSchema;
}

export function dynamicNumber(description?: string) {
  return description
    ? DynamicNumberSchema.describe(`REF:#/$defs/DynamicNumber|${description}`)
    : DynamicNumberSchema;
}

export function dynamicBoolean(description?: string) {
  return description
    ? DynamicBooleanSchema.describe(`REF:#/$defs/DynamicBoolean|${description}`)
    : DynamicBooleanSchema;
}

export function dynamicValue(description?: string) {
  return description
    ? DynamicValueSchema.describe(`REF:#/$defs/DynamicValue|${description}`)
    : DynamicValueSchema;
}

export function dynamicStringList(description?: string) {
  return description
    ? DynamicStringListSchema.describe(`REF:#/$defs/DynamicStringList|${description}`)
    : DynamicStringListSchema;
}

export function childList(options: RefSchemaOptions = {}): typeof ChildListSchema {
  if (options.description === undefined) {
    return ChildListSchema;
  }
  return ChildListSchema.describe(options.description);
}

export const AnyComponentSchema = z
  .object({
    'component': z.string().describe('The type name of the component.'),
    'id': ComponentIdSchema.optional(),
    'weight': z.number().optional(),
  })
  .passthrough()
  .describe('A generic A2UI component definition.');
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
