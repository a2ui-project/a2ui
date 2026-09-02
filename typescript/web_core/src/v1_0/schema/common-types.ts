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
// Generated from specification/v1_0/json/ via scripts/generate-zod-schemas.mjs
import {z} from 'zod';

export type ChildRefKind = 'component-id' | 'child-list';

function markChildRef<T extends z.ZodTypeAny>(schema: T, ref: ChildRefKind): T {
  (schema._def as {a2uiChildRef?: ChildRefKind}).a2uiChildRef = ref;
  return schema;
}

export function childRefKindOf(schema: z.ZodTypeAny): ChildRefKind | undefined {
  return (schema?._def as {a2uiChildRef?: ChildRefKind} | undefined)?.a2uiChildRef;
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
  .strict()
  .describe(
    'REF:#/$defs/TemplateChildList|A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.',
  );
export type TemplateChildList = z.infer<typeof TemplateChildListSchema>;

export const ComponentIdSchema = markChildRef(
  z
    .string()
    .describe(
      'REF:#/$defs/ComponentId|The unique identifier for a component, used for both definitions and references within the same surface.',
    ),
  'component-id',
);
export type ComponentId = z.infer<typeof ComponentIdSchema>;

export const CallIdSchema = z
  .string()
  .describe('REF:#/$defs/CallId|The unique identifier for a function call.');
export type CallId = z.infer<typeof CallIdSchema>;

export const DataBindingSchema = z
  .object({
    'path': z.string().describe('A JSON Pointer path to a value in the data model.'),
  })
  .strict()
  .describe('REF:#/$defs/DataBinding|A JSON Pointer path to a value in the data model.');
export type DataBinding = z.infer<typeof DataBindingSchema>;

export const DynamicValueSchema = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    z.record(z.string(), z.any()).refine(obj => !obj || (!('path' in obj) && !('call' in obj))),
    DataBindingSchema,
    z.lazy(() => FunctionCallSchema),
  ])
  .describe(
    'REF:#/$defs/DynamicValue|A value that can be a literal, a path, or a function call returning any type.',
  );
export type DynamicValue = z.infer<typeof DynamicValueSchema>;

export const DynamicNumberSchema = z
  .union([z.number(), DataBindingSchema, z.lazy(() => FunctionCallSchema)])
  .describe(
    'REF:#/$defs/DynamicNumber|Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.',
  );
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
    'Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context.',
  );
export type IndexSystemFunction = z.infer<typeof IndexSystemFunctionSchema>;

export const FunctionCallSchema = z
  .object({
    'call': z.string().describe('The name of the function to call.'),
    'catalogId': z.string().optional().describe('The ID of the catalog containing the function.'),
    'args': z.record(z.any()).optional().describe('Arguments passed to the function.'),
    'returnType': z
      .enum(['string', 'number', 'boolean', 'array', 'object', 'validationResult', 'any', 'void'])
      .optional(),
  })
  .describe('REF:#/$defs/FunctionCall|Invokes a named function on the client.');
export type FunctionCall = z.infer<typeof FunctionCallSchema>;

export const DynamicStringSchema = z
  .union([z.string(), DataBindingSchema, z.lazy(() => FunctionCallSchema)])
  .describe('REF:#/$defs/DynamicString|Represents a dynamic string value.');
export type DynamicString = z.infer<typeof DynamicStringSchema>;

export const DynamicBooleanSchema = z
  .union([z.boolean(), DataBindingSchema, z.lazy(() => FunctionCallSchema)])
  .describe(
    'REF:#/$defs/DynamicBoolean|A boolean value that can be a literal, a path, or a function call returning a boolean.',
  );
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
  .describe('REF:#/$defs/AccessibilityAttributes|Attributes to enhance accessibility.');
export type AccessibilityAttributes = z.infer<typeof AccessibilityAttributesSchema>;

export const ExtensionsSchema = z
  .record(z.string(), z.union([z.any(), z.never()]))
  .superRefine((value, ctx) => {
    for (const key in value) {
      let evaluated = false;
      if (key.match(new RegExp('^[\\p{XID_Start}_][\\p{XID_Continue}]*$'))) {
        evaluated = true;
        const result = z.any().safeParse(value[key]);
        if (!result.success) {
          ctx.addIssue({
            path: [key],
            code: 'custom',
            message: `Invalid input: Key matching regex /${key}/ must match schema`,
            params: {
              issues: result.error.issues,
            },
          });
        }
      }
      if (!evaluated) {
        const result = z.never().safeParse(value[key]);
        if (!result.success) {
          ctx.addIssue({
            path: [key],
            code: 'custom',
            message: `Invalid input: must match catchall schema`,
            params: {
              issues: result.error.issues,
            },
          });
        }
      }
    }
  })
  .describe(
    "Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.",
  );
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

export const ChildSchema = ComponentIdSchema;
export type Child = z.infer<typeof ChildSchema>;

export const ChildListSchema = markChildRef(
  z
    .union([
      z.array(ComponentIdSchema).describe('A static list of child component IDs.'),
      TemplateChildListSchema,
    ])
    .describe('REF:#/$defs/ChildList'),
  'child-list',
);
export type ChildList = z.infer<typeof ChildListSchema>;

export const DynamicStringListSchema = z
  .union([z.array(z.string()), DataBindingSchema, z.lazy(() => FunctionCallSchema)])
  .describe(
    'REF:#/$defs/DynamicStringList|Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.',
  );
export type DynamicStringList = z.infer<typeof DynamicStringListSchema>;

export const FunctionCommonSchema = z
  .object({
    'catalogId': z
      .string()
      .describe('The catalog ID for this function, overriding any surface-level default catalogId.')
      .optional(),
  })
  .strict();
export type FunctionCommon = z.infer<typeof FunctionCommonSchema>;

export const CheckRuleSchema = z
  .object({
    'condition': DynamicBooleanSchema,
    'message': z.string().describe('The error message to display if the check fails.'),
  })
  .describe('REF:#/$defs/CheckRule|A check rule consisting of a condition and an error message.');
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
  .describe('REF:#/$defs/Checkable|Properties for components that support client-side checks.');
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
  .describe('REF:#/$defs/Action|Triggers a server-side event or a local client-side function.');
export type Action = z.infer<typeof ActionSchema>;

export const SurfaceSchema = z
  .object({
    'component': z.literal('Surface').optional(),
    'child': z.literal('root').optional(),
  })
  .strict()
  .describe(
    "The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has 'child': 'root'.",
  );
export type Surface = z.infer<typeof SurfaceSchema>;

export const FunctionResponseSchema = z
  .union([z.any(), z.any()])
  .describe('The return response matching a callAgentFunction or callRendererFunction invocation.');
export type FunctionResponse = z.infer<typeof FunctionResponseSchema>;

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
  return ChildListSchema.describe(`REF:#/$defs/ChildList|${options.description}`);
}

export const CommonSchemas = {
  ComponentId: ComponentIdSchema,
  Child: ChildSchema,
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
  ComponentCommon: ComponentCommonSchema,
  Extensions: ExtensionsSchema,
  Surface: SurfaceSchema,
};
