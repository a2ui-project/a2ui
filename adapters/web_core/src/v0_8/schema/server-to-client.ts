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
import {
  AudioPlayerSchema,
  ButtonSchema,
  CardSchema,
  CheckboxSchema,
  ColumnSchema,
  DateTimeInputSchema,
  DividerSchema,
  IconSchema,
  ImageSchema,
  ListSchema,
  ModalSchema,
  MultipleChoiceSchema,
  RowSchema,
  SliderSchema,
  TabsSchema,
  TextFieldSchema,
  TextSchema,
  VideoSchema,
  DataValueSchema,
} from './common-types.js';

const validateValueProperty = (val: any, ctx: z.RefinementCtx) => {
  let count = 0;
  if (val.valueString !== undefined) count++;
  if (val.valueNumber !== undefined) count++;
  if (val.valueBoolean !== undefined) count++;
  if (val.valueMap !== undefined) count++;
  if (count !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Must have exactly one value property (valueString, valueNumber, valueBoolean, valueMap), found ${count}.`,
    });
  }
};

export const ValueMapSchema = DataValueSchema.describe(
  "A single data entry. Exactly one 'value*' property should be provided alongside the key.",
);

export const AnyComponentSchema = z
  .object({
    Text: TextSchema.optional(),
    Image: ImageSchema.optional(),
    Icon: IconSchema.optional(),
    Video: VideoSchema.optional(),
    AudioPlayer: AudioPlayerSchema.optional(),
    Row: z.lazy(() => RowSchema).optional(),
    Column: z.lazy(() => ColumnSchema).optional(),
    List: z.lazy(() => ListSchema).optional(),
    Card: z.lazy(() => CardSchema).optional(),
    Tabs: TabsSchema.optional(),
    Divider: DividerSchema.optional(),
    Modal: ModalSchema.optional(),
    Button: ButtonSchema.optional(),
    Checkbox: CheckboxSchema.optional(),
    TextField: TextFieldSchema.optional(),
    DateTimeInput: DateTimeInputSchema.optional(),
    MultipleChoice: MultipleChoiceSchema.optional(),
    Slider: SliderSchema.optional(),
  })
  .catchall(z.any());

export const ComponentPropertiesSchema = AnyComponentSchema;

export const ComponentInstanceSchema = z
  .object({
    id: z.string().describe('The unique identifier for this component.'),
    weight: z
      .number()
      .optional()
      .describe(
        "The relative weight of this component within a Row or Column. This corresponds to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column.",
      ),
    component: ComponentPropertiesSchema.describe(
      "A wrapper object that MUST contain exactly one key, which is the name of the component type (e.g., 'Heading'). The value is an object containing the properties for that specific component.",
    ),
  })
  .strict()
  .describe(
    'Represents a *single* component in a UI widget tree. This component could be one of many supported types.',
  );

export const BeginRenderingMessageSchema = z
  .object({
    surfaceId: z.string().describe('The unique identifier for the UI surface to be rendered.'),
    catalogId: z
      .string()
      .optional()
      .describe(
        'The identifier of the component catalog to use for this surface. If omitted, the client MUST default to the standard catalog for this A2UI version (https://a2ui.org/specification/v0_8/standard_catalog_definition.json).',
      ),
    root: z.string().describe('The ID of the root component to render.'),
    styles: z
      .object({
        font: z.string().optional().describe('The primary font for the UI.'),
        primaryColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional()
          .describe("The primary UI color as a hexadecimal code (e.g., '#00BFFF')."),
      })
      .strict()
      .optional()
      .describe('Styling information for the UI.'),
  })
  .strict()
  .describe(
    'Signals the client to begin rendering a surface with a root component and specific styles.',
  );

export const SurfaceUpdateMessageSchema = z
  .object({
    surfaceId: z
      .string()
      .describe(
        'The unique identifier for the UI surface to be updated. If you are adding a new surface this *must* be a new, unique identified that has never been used for any existing surfaces shown.',
      ),
    components: z
      .array(ComponentInstanceSchema)
      .min(1)
      .describe('A list containing all UI components for the surface.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    const componentIds = new Set<string>();
    for (const c of data.components) {
      if (c.id) {
        if (componentIds.has(c.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate component ID found: ${c.id}`,
            path: ['components'],
          });
        }
        componentIds.add(c.id);
      }
    }

    const checkRefs = (ids: (string | undefined)[], componentId: string) => {
      for (const id of ids) {
        if (id && !componentIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Component '${componentId}' references non-existent component ID '${id}'.`,
            path: ['components'],
          });
        }
      }
    };

    for (const component of data.components) {
      if (!component.id || !component.component) continue;
      const componentTypes = Object.keys(component.component);
      if (componentTypes.length !== 1) continue;

      const componentType = componentTypes[0];
      const properties: any = (component.component as any)[componentType];

      switch (componentType) {
        case 'Row':
        case 'Column':
        case 'List':
          if (properties.children && !Array.isArray(properties.children)) {
            const hasExplicit = !!properties.children.explicitList;
            const hasTemplate = !!properties.children.template;
            if ((hasExplicit && hasTemplate) || (!hasExplicit && !hasTemplate)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Component '${component.id}' must have either 'explicitList' or 'template' in children, but not both or neither.`,
              });
            }
            if (hasExplicit) checkRefs(properties.children.explicitList, component.id);
            if (hasTemplate) checkRefs([properties.children.template?.componentId], component.id);
          }
          break;
        case 'Card':
          if (properties.child) checkRefs([properties.child], component.id);
          break;
        case 'Tabs':
          if (properties.tabItems && Array.isArray(properties.tabItems)) {
            properties.tabItems.forEach((tab: any) => {
              if (tab.child) checkRefs([tab.child], component.id);
            });
          }
          break;
        case 'Modal':
          checkRefs([properties.entryPointChild, properties.contentChild], component.id);
          break;
        case 'Button':
          if (properties.child) checkRefs([properties.child], component.id);
          break;
      }
    }
  })
  .describe('Updates a surface with a new set of components.');

export const DataModelUpdateMessageSchema = z
  .object({
    surfaceId: z
      .string()
      .describe('The unique identifier for the UI surface this data model update applies to.'),
    path: z
      .string()
      .optional()
      .describe(
        "An optional path to a location within the data model (e.g., '/user/name'). If omitted, or set to '/', the entire data model will be replaced.",
      ),
    contents: z
      .array(ValueMapSchema)
      .describe(
        "An array of data entries. Each entry must contain a 'key' and exactly one corresponding typed 'value*' property.",
      ),
  })
  .strict()
  .describe('Updates the data model for a surface.');

export const DeleteSurfaceMessageSchema = z
  .object({
    surfaceId: z.string().describe('The unique identifier for the UI surface to be deleted.'),
  })
  .strict()
  .describe("Signals the client to delete the surface identified by 'surfaceId'.");

export const A2uiMessageSchema = z
  .object({
    beginRendering: BeginRenderingMessageSchema.optional(),
    surfaceUpdate: SurfaceUpdateMessageSchema.optional(),
    dataModelUpdate: DataModelUpdateMessageSchema.optional(),
    deleteSurface: DeleteSurfaceMessageSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const keys = Object.keys(data).filter(k =>
      ['beginRendering', 'surfaceUpdate', 'dataModelUpdate', 'deleteSurface'].includes(k),
    );
    if (keys.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'A2UI Protocol message must have exactly one of: surfaceUpdate, dataModelUpdate, beginRendering, deleteSurface.',
      });
    }
  })
  .describe(
    "Describes a JSON payload for an A2UI (Agent to UI) message, which is used to dynamically construct and update user interfaces. A message MUST contain exactly ONE of the action properties: 'beginRendering', 'surfaceUpdate', 'dataModelUpdate', or 'deleteSurface'.",
  );

export type A2uiMessage = z.infer<typeof A2uiMessageSchema>;
