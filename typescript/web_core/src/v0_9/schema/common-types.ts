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

export const DataBindingSchema = z
  .object({
    'path': z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .describe('REF:#/$defs/DataBinding');
export type DataBindingType = z.infer<typeof DataBindingSchema>;

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
export type FunctionCallType = z.infer<typeof FunctionCallSchema>;

export const SvgPathSchema = z
  .object({
    'svgPath': z.string(),
  })
  .describe('REF:#/$defs/SvgPath');
export type SvgPathType = z.infer<typeof SvgPathSchema>;

export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicBoolean');

export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicString');

export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicNumber');

export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, FunctionCallSchema])
  .describe('REF:#/$defs/DynamicStringList');

export const DynamicValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    DataBindingSchema,
    FunctionCallSchema,
    z.record(z.any()),
  ])
  .describe('REF:#/$defs/DynamicValue');

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

export const ComponentIdSchema = markChildRef(
  z.string().describe('REF:#/$defs/ComponentId'),
  'component-id',
);
/** The unique identifier for a component. */
export type ComponentId = z.infer<typeof ComponentIdSchema>;

/**
 * Describes a component-id property without losing its `REF:` pointer.
 * `.describe()` replaces the whole description, so calling it directly on
 * {@link ComponentIdSchema} silently drops the pointer that the capabilities
 * generator turns into a wire `$ref` and the node layer reads to classify
 * child-reference properties.
 */
/** How a schema marked as a child reference is classified. */
export type ChildRefKind = 'component-id' | 'child-list';

/**
 * Stamps the child-reference kind into the schema's zod metadata. Methods
 * like `.describe()` and `.optional()` rebuild schemas from `_def`, so the
 * flag survives them; the `REF:` description remains the wire-facing pointer
 * the capabilities generator resolves into a `$ref`.
 */
function markChildRef<T extends z.ZodTypeAny>(schema: T, ref: ChildRefKind): T {
  (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef = ref;
  return schema;
}

export function childRefKindOf(schema: z.ZodTypeAny): ChildRefKind | undefined {
  return (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef;
}

export interface RefSchemaOptions {
  /** Prose appended after the `REF:` pointer; shown in generated capabilities. */
  readonly description?: string;
}

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

export const TemplateChildListSchema = z
  .object({
    'componentId': ComponentIdSchema,
    'path': z
      .string()
      .describe('The path to the list of component property objects in the data model.'),
  })
  .describe('REF:#/$defs/TemplateChildList');

export const ChildListSchema = markChildRef(
  z.union([z.array(ComponentIdSchema), TemplateChildListSchema]),
  'child-list',
);
/** A static list of child component IDs or a dynamic list template. */
export type ChildList = z.infer<typeof ChildListSchema>;

/**
 * Describes a child-list property without losing its `REF:` pointer; the
 * same hazard {@link componentId} exists for.
 */
export function childList(options: RefSchemaOptions = {}): typeof ChildListSchema {
  if (options.description === undefined) {
    return ChildListSchema;
  }
  return ChildListSchema.describe(options.description);
}

export const TabItemSchema = z
  .object({
    'title': dynamicString('The tab title.'),
    'child': ComponentIdSchema.describe('REF:#/$defs/ComponentId|The ID of the child component.'),
  })
  .describe('REF:#/$defs/TabItem');

export const ActionEventSchema = z
  .object({
    'name': z.string().describe('The name of the action to be dispatched to the server.'),
    'context': z
      .record(dynamicValue())
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

export const ActionSchema = z.union([ActionEventWrapperSchema, ActionFunctionCallWrapperSchema]);
/** Triggers a server-side event or a local client-side function. */
export type Action = z.infer<typeof ActionSchema>;

export const CheckRuleSchema = z
  .object({
    'condition': dynamicBoolean(),
    'message': z.string().describe('The error message to display if the check fails.'),
  })
  .describe('REF:#/$defs/CheckRule');
/** A check rule consisting of a condition and an error message. */
export type CheckRule = z.infer<typeof CheckRuleSchema>;

export const CheckableSchema = z.object({
  'checks': z
    .array(CheckRuleSchema)
    .describe(
      'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
    )
    .optional(),
});
/** An object that contains checks. */
export type Checkable = z.infer<typeof CheckableSchema>;

export const OptionItemSchema = z
  .object({
    'label': dynamicString('The text to display for this option.'),
    'value': z.string().describe('The stable value associated with this option.'),
  })
  .describe('REF:#/$defs/OptionItem');

export const AccessibilityAttributesSchema = z
  .object({
    'label': dynamicString(
      "A short string, typically 1 to 3 words, used by assistive technologies to convey the purpose or intent of an element. For example, an input field might have an accessible label of 'User ID' or a button might be labeled 'Submit'.",
    ).optional(),
    'description': dynamicString(
      "Additional information provided by assistive technologies about an element such as instructions, format requirements, or result of an action. For example, a mute button might have a label of 'Mute' and a description of 'Silences notifications about this conversation'.",
    ).optional(),
  })
  .describe('REF:#/$defs/AccessibilityAttributes');

/** Accessibility attributes like label and description. */
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

export const AnyComponentSchema = z
  .object({
    'component': z.string().describe('The type name of the component.'),
    'id': ComponentIdSchema.optional(),
    'weight': z.number().optional(),
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
