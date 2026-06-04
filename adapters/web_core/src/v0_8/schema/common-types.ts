/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {z} from 'zod';

/**
 * Base primitives
 */

const exactlyOneKey = (val: any, ctx: z.RefinementCtx) => {
  const keys = Object.keys(val).filter(k => val[k] !== undefined);
  if (keys.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Must define exactly one property, found ${keys.length} (${keys.join(', ')}).`,
    });
  }
};

export const StringValueSchema = z
  .object({
    path: z.string().optional(),
    literalString: z.string().optional(),
    literal: z.string().optional(),
  })
  .strict()
  .superRefine(exactlyOneKey);
export type StringValue = z.infer<typeof StringValueSchema>;

const DataValueMapItemSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      key: z.string(),
      valueString: z.string().optional(),
      valueNumber: z.number().optional(),
      valueBoolean: z.boolean().optional(),
      valueMap: z.array(DataValueMapItemSchema).optional(),
    })
    .strict()
    .superRefine((val: any, ctx: z.RefinementCtx) => {
      let count = 0;
      if (val.valueString !== undefined) count++;
      if (val.valueNumber !== undefined) count++;
      if (val.valueBoolean !== undefined) count++;
      if (val.valueMap !== undefined) count++;
      if (count !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Value map item must have exactly one value property (valueString, valueNumber, valueBoolean, valueMap), found ${count}.`,
        });
      }
    }),
);

export function createDataValueSchema(options: {maxDepth?: number} = {}) {
  const maxDepth = options.maxDepth ?? 5;
  return DataValueMapItemSchema.superRefine((val: any, ctx: z.RefinementCtx) => {
    const checkDepth = (v: any, currentDepth: number) => {
      if (currentDepth > maxDepth) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `valueMap recursion exceeded maximum depth of ${maxDepth}.`,
        });
        return;
      }
      if (v.valueMap && Array.isArray(v.valueMap)) {
        for (const item of v.valueMap) {
          checkDepth(item, currentDepth + 1);
        }
      }
    };
    checkDepth(val, 1);
  });
}

export const DataValueSchema = createDataValueSchema();

export const NumberValueSchema = z
  .object({
    path: z.string().optional(),
    literalNumber: z.number().optional(),
    literal: z.number().optional(),
  })
  .strict()
  .superRefine(exactlyOneKey);
export type NumberValue = z.infer<typeof NumberValueSchema>;

export const BooleanValueSchema = z
  .object({
    path: z.string().optional(),
    literalBoolean: z.boolean().optional(),
    literal: z.boolean().optional(),
  })
  .strict()
  .superRefine(exactlyOneKey);
export type BooleanValue = z.infer<typeof BooleanValueSchema>;

/**
 * Action Schema for components that trigger user actions
 */
export const ActionSchema = z.object({
  name: z.string().describe("A unique name identifying the action (e.g., 'submitForm')."),
  context: z
    .array(
      z.object({
        key: z.string(),
        value: z
          .object({
            path: z
              .string()
              .describe(
                "A data binding reference to a location in the data model (e.g., '/user/name').",
              )
              .optional(),
            literalString: z.string().describe('A fixed, hardcoded string value.').optional(),
            literalNumber: z.number().optional(),
            literalBoolean: z.boolean().optional(),
          })
          .describe('The dynamic value. Define EXACTLY ONE of the nested properties.')
          .strict()
          .superRefine(exactlyOneKey),
      }),
    )
    .describe('A key-value map of data bindings to be resolved when the action is triggered.')
    .optional(),
});

/**
 * Component Properties Schemas
 */

export const TextSchema = z.object({
  text: StringValueSchema,
  usageHint: z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body']).optional(),
});

export const ImageSchema = z.object({
  url: StringValueSchema,
  usageHint: z
    .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
    .optional(),
  fit: z.enum(['contain', 'cover', 'fill', 'none', 'scale-down']).optional(),
  altText: StringValueSchema.optional(),
});

export const IconSchema = z.object({
  name: StringValueSchema,
});

export const VideoSchema = z.object({
  url: StringValueSchema,
});

export const AudioPlayerSchema = z.object({
  url: StringValueSchema,
  description: StringValueSchema.optional().describe('A label, title, or placeholder text.'),
});

export const TabsSchema = z.object({
  tabItems: z
    .array(
      z
        .object({
          title: z.object({
            path: z
              .string()
              .describe(
                "A data binding reference to a location in the data model (e.g., '/user/name').",
              )
              .optional(),
            literalString: z.string().describe('A fixed, hardcoded string value.').optional(),
          }),
          child: z.string().describe('A reference to a component instance by its unique ID.'),
        })
        .strict()
        .superRefine((val: any, ctx: z.RefinementCtx) => {
          if (!val.title) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Tab item is missing 'title'.",
            });
          }
          if (!val.child) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Tab item is missing 'child'.",
            });
          }
          if (val.title) {
            exactlyOneKey(val.title, ctx);
          }
        }),
    )
    .describe('A list of tabs, each with a title and a child component ID.'),
});

export const DividerSchema = z.object({
  axis: z.enum(['horizontal', 'vertical']).optional().describe('The orientation.'),
  color: z
    .string()
    .optional()
    .describe('The color of the divider (e.g., hex code or semantic name).'),
  thickness: z.number().optional().describe('The thickness of the divider.'),
});

export const ModalSchema = z.object({
  entryPointChild: z
    .string()
    .describe('The ID of the component (e.g., a button) that triggers the modal.'),
  contentChild: z.string().describe("The ID of the component to display as the modal's content."),
});

export const ButtonSchema = z.object({
  child: z.string().describe("The ID of the component to display as the button's content."),
  action: ActionSchema.describe('Represents a user-initiated action.'),
  primary: z
    .boolean()
    .optional()
    .describe('Indicates if this button should be styled as the primary action.'),
});

export const CheckboxSchema = z.object({
  label: StringValueSchema,
  value: z
    .object({
      path: z
        .string()
        .describe("A data binding reference to a location in the data model (e.g., '/user/name').")
        .optional(),
      literalBoolean: z.boolean().optional(),
    })
    .strict()
    .superRefine(exactlyOneKey),
});

export const TextFieldSchema = z.object({
  text: StringValueSchema.optional(),
  label: StringValueSchema.describe('A label, title, or placeholder text.'),
  textFieldType: z.enum(['shortText', 'number', 'date', 'longText', 'obscured']).optional(),
  validationRegexp: z.string().optional().describe('A regex string to validate the input.'),
});

export const DateTimeInputSchema = z.object({
  value: StringValueSchema,
  enableDate: z.boolean().optional(),
  enableTime: z.boolean().optional(),
  outputFormat: z
    .string()
    .optional()
    .describe("The string format for the output (e.g., 'YYYY-MM-DD')."),
});

export const MultipleChoiceSchema = z.object({
  selections: z
    .object({
      path: z
        .string()
        .describe("A data binding reference to a location in the data model (e.g., '/user/name').")
        .optional(),
      literalArray: z.array(z.string()).optional(),
    })
    .strict()
    .superRefine(exactlyOneKey),
  options: z
    .array(
      z.object({
        label: z
          .object({
            path: z
              .string()
              .describe(
                "A data binding reference to a location in the data model (e.g., '/user/name').",
              )
              .optional(),
            literalString: z.string().describe('A fixed, hardcoded string value.').optional(),
          })
          .strict()
          .superRefine(exactlyOneKey),
        value: z.string(),
      }),
    )
    .optional(),
  maxAllowedSelections: z.number().optional(),
  type: z.enum(['checkbox', 'chips']).optional(),
  filterable: z.boolean().optional(),
});

export const SliderSchema = z.object({
  value: z
    .object({
      path: z
        .string()
        .describe("A data binding reference to a location in the data model (e.g., '/user/name').")
        .optional(),
      literalNumber: z.number().optional(),
    })
    .strict()
    .superRefine(exactlyOneKey),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  label: StringValueSchema.optional(),
});

export const ComponentArrayTemplateSchema = z.object({
  componentId: z.string(),
  dataBinding: z.string(),
});

export const ComponentArrayReferenceSchema = z
  .object({
    explicitList: z.array(z.string()).optional(),
    template: ComponentArrayTemplateSchema.describe(
      'A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.',
    ).optional(),
  })
  .strict()
  .superRefine(exactlyOneKey);

export const RowSchema = z.object({
  children: ComponentArrayReferenceSchema,
  distribution: z
    .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly'])
    .optional(),
  alignment: z.enum(['start', 'center', 'end', 'stretch']).optional(),
});

export const ColumnSchema = z.object({
  children: ComponentArrayReferenceSchema,
  distribution: z
    .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly'])
    .optional(),
  alignment: z.enum(['start', 'center', 'end', 'stretch']).optional(),
});

export const ListSchema = z.object({
  children: ComponentArrayReferenceSchema,
  direction: z.enum(['vertical', 'horizontal']).optional(),
  alignment: z.enum(['start', 'center', 'end', 'stretch']).optional(),
});

export const CardSchema = z.object({
  child: z.string().describe('The ID of the component to be rendered inside the card.'),
});
