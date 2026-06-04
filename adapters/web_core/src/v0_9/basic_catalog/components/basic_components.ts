/*
 * Copyright 2026 Google LLC
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
import {
  DynamicStringSchema,
  DynamicNumberSchema,
  DynamicBooleanSchema,
  DynamicStringListSchema,
  ChildListSchema,
  ComponentIdSchema,
  ActionSchema,
  AccessibilityAttributesSchema,
  CheckableSchema,
} from '../../schema/common-types.js';
import {ComponentApi} from '../../catalog/types.js';

const CommonProps = {
  accessibility: AccessibilityAttributesSchema.optional(),
  weight: z
    .number()
    .describe(
      "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column.",
    )
    .optional(),
};

export const TextApi = {
  name: 'Text',
  schema: z
    .object({
      ...CommonProps,
      text: DynamicStringSchema.describe(
        'The text content to display. While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.',
      ),
      variant: z
        .enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'])
        .default('body')
        .describe('A hint for the base text style.')
        .optional(),
    })
    .strict(),
} satisfies ComponentApi;

export const ImageApi = {
  name: 'Image',
  schema: z
    .object({
      ...CommonProps,
      url: DynamicStringSchema.describe('The URL of the image to display.'),
      description: DynamicStringSchema.describe(
        'The accessibility description of the image.',
      ).optional(),
      fit: z
        .enum(['contain', 'cover', 'fill', 'none', 'scaleDown'])
        .default('fill')
        .describe(
          "Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
        )
        .optional(),
      variant: z
        .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
        .default('mediumFeature')
        .describe('A hint for the image size and style.')
        .optional(),
    })
    .strict(),
} satisfies ComponentApi;

const ICON_NAMES = [
  'accountCircle',
  'add',
  'arrowBack',
  'arrowForward',
  'attachFile',
  'calendarToday',
  'call',
  'camera',
  'check',
  'close',
  'delete',
  'download',
  'edit',
  'event',
  'error',
  'fastForward',
  'favorite',
  'favoriteOff',
  'folder',
  'help',
  'home',
  'info',
  'locationOn',
  'lock',
  'lockOpen',
  'mail',
  'menu',
  'moreVert',
  'moreHoriz',
  'notificationsOff',
  'notifications',
  'pause',
  'payment',
  'person',
  'phone',
  'photo',
  'play',
  'print',
  'refresh',
  'rewind',
  'search',
  'send',
  'settings',
  'share',
  'shoppingCart',
  'skipNext',
  'skipPrevious',
  'star',
  'starHalf',
  'starOff',
  'stop',
  'upload',
  'visibility',
  'visibilityOff',
  'volumeDown',
  'volumeMute',
  'volumeOff',
  'volumeUp',
  'warning',
] as const;

export const IconApi = {
  name: 'Icon',
  schema: z
    .object({
      ...CommonProps,
      name: z
        .union([
          z.enum(ICON_NAMES),
          z
            .object({
              svgPath: z.string().describe('Custom SVG path data'),
            })
            .strict(),
          z
            .object({
              path: z.string(),
            })
            .strict(),
        ])
        .describe('The name of the icon to display.'),
    })
    .strict(),
} satisfies ComponentApi;

export const VideoApi = {
  name: 'Video',
  schema: z
    .object({
      ...CommonProps,
      url: DynamicStringSchema.describe('The URL of the video to display.'),
    })
    .strict(),
} satisfies ComponentApi;

export const AudioPlayerApi = {
  name: 'AudioPlayer',
  schema: z
    .object({
      ...CommonProps,
      url: DynamicStringSchema.describe('The URL of the audio to be played.'),
      description: DynamicStringSchema.describe(
        'A description of the audio, such as a title or summary.',
      ).optional(),
    })
    .strict(),
} satisfies ComponentApi;

export const RowApi = {
  name: 'Row',
  schema: z
    .object({
      ...CommonProps,
      children: ChildListSchema.describe(
        'Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.',
      ),
      justify: z
        .enum(['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly', 'start', 'stretch'])
        .default('start')
        .describe(
          "Defines the arrangement of children along the main axis (horizontally). Use 'spaceBetween' to push items to the edges, or 'start'/'end'/'center' to pack them together.",
        )
        .optional(),
      align: z
        .enum(['start', 'center', 'end', 'stretch'])
        .default('stretch')
        .describe(
          "Defines the alignment of children along the cross axis (vertically). This is similar to the CSS 'align-items' property, but uses camelCase values (e.g., 'start').",
        )
        .optional(),
    })
    .strict()
    .describe(
      'A layout component that arranges its children horizontally. To create a grid layout, nest Columns within this Row.',
    ),
} satisfies ComponentApi;

export const ColumnApi = {
  name: 'Column',
  schema: z
    .object({
      ...CommonProps,
      children: ChildListSchema.describe(
        'Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.',
      ),
      justify: z
        .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'])
        .default('start')
        .describe(
          "Defines the arrangement of children along the main axis (vertically). Use 'spaceBetween' to push items to the edges (e.g. header at top, footer at bottom), or 'start'/'end'/'center' to pack them together.",
        )
        .optional(),
      align: z
        .enum(['center', 'end', 'start', 'stretch'])
        .default('stretch')
        .describe(
          "Defines the alignment of children along the cross axis (horizontally). This is similar to the CSS 'align-items' property.",
        )
        .optional(),
    })
    .strict()
    .describe(
      'A layout component that arranges its children vertically. To create a grid layout, nest Rows within this Column.',
    ),
} satisfies ComponentApi;

export const ListApi = {
  name: 'List',
  schema: z
    .object({
      ...CommonProps,
      children: ChildListSchema.describe(
        'Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list.',
      ),
      direction: z
        .enum(['vertical', 'horizontal'])
        .default('vertical')
        .describe('The direction in which the list items are laid out.')
        .optional(),
      align: z
        .enum(['start', 'center', 'end', 'stretch'])
        .default('stretch')
        .describe('Defines the alignment of children along the cross axis.')
        .optional(),
      listStyle: z
        .enum(['ordered', 'unordered', 'none'])
        .describe('The style of the list (ordered, unordered, or none).')
        .optional(),
    })
    .strict(),
} satisfies ComponentApi;

export const CardApi = {
  name: 'Card',
  schema: z
    .object({
      ...CommonProps,
      child: ComponentIdSchema.describe(
        "The ID of the single child component to be rendered inside the card. To display multiple elements, you MUST wrap them in a layout component (like Column or Row) and pass that container's ID here. Do NOT pass multiple IDs or a non-existent ID. Do NOT define the child component inline.",
      ),
    })
    .strict(),
} satisfies ComponentApi;

export const TabsApi = {
  name: 'Tabs',
  schema: z
    .object({
      ...CommonProps,
      tabs: z
        .array(
          z
            .object({
              title: DynamicStringSchema.describe('The tab title.'),
              child: ComponentIdSchema.describe(
                'The ID of the child component. Do NOT define the component inline.',
              ),
            })
            .strict(),
        )
        .min(1)
        .describe(
          'An array of objects, where each object defines a tab with a title and a child component.',
        ),
    })
    .strict(),
} satisfies ComponentApi;

export const ModalApi = {
  name: 'Modal',
  schema: z
    .object({
      ...CommonProps,
      trigger: ComponentIdSchema.describe(
        'The ID of the component that opens the modal when interacted with (e.g., a button). Do NOT define the component inline.',
      ),
      content: ComponentIdSchema.describe(
        'The ID of the component to be displayed inside the modal. Do NOT define the component inline.',
      ),
    })
    .strict(),
} satisfies ComponentApi;

export const DividerApi = {
  name: 'Divider',
  schema: z
    .object({
      ...CommonProps,
      axis: z
        .enum(['horizontal', 'vertical'])
        .default('horizontal')
        .describe('The orientation of the divider.')
        .optional(),
    })
    .strict(),
} satisfies ComponentApi;

export const ButtonApi = {
  name: 'Button',
  schema: z
    .object({
      ...CommonProps,
      child: ComponentIdSchema.describe(
        "The ID of the child component. Use a 'Text' component for a labeled button. Only use an 'Icon' if the requirements explicitly ask for an icon-only button. Do NOT define the child component inline.",
      ),
      variant: z
        .enum(['default', 'primary', 'borderless'])
        .default('default')
        .describe(
          "A hint for the button style. If omitted, a default button style is used. 'primary' indicates this is the main call-to-action button. 'borderless' means the button has no visual border or background, making its child content appear like a clickable link.",
        )
        .optional(),
      action: ActionSchema,
      checks: CheckableSchema.shape.checks,
    })
    .strict(),
} satisfies ComponentApi;

export const TextFieldApi = {
  name: 'TextField',
  schema: z
    .object({
      ...CommonProps,
      label: DynamicStringSchema.describe('The text label for the input field.'),
      value: DynamicStringSchema.describe('The value of the text field.').optional(),
      variant: z
        .enum(['longText', 'number', 'shortText', 'obscured'])
        .default('shortText')
        .describe('The type of input field to display.')
        .optional(),
      validationRegexp: z
        .string()
        .describe('A regular expression used for client-side validation of the input.')
        .optional(),
      checks: CheckableSchema.shape.checks,
    })
    .strict(),
} satisfies ComponentApi;

export const CheckBoxApi = {
  name: 'CheckBox',
  schema: z
    .object({
      ...CommonProps,
      label: DynamicStringSchema.describe('The text to display next to the checkbox.'),
      value: DynamicBooleanSchema.describe(
        'The current state of the checkbox (true for checked, false for unchecked).',
      ),
      checks: CheckableSchema.shape.checks,
    })
    .strict(),
} satisfies ComponentApi;

export const ChoicePickerApi = {
  name: 'ChoicePicker',
  schema: z
    .object({
      ...CommonProps,
      label: DynamicStringSchema.describe('The label for the group of options.').optional(),
      variant: z
        .enum(['multipleSelection', 'mutuallyExclusive'])
        .default('mutuallyExclusive')
        .describe('A hint for how the choice picker should be displayed and behave.')
        .optional(),
      options: z
        .array(
          z
            .object({
              label: DynamicStringSchema.describe('The text to display for this option.'),
              value: z.string().describe('The stable value associated with this option.'),
            })
            .strict(),
        )
        .describe('The list of available options to choose from.'),
      value: DynamicStringListSchema.describe(
        'The list of currently selected values. This should be bound to a string array in the data model.',
      ),
      displayStyle: z
        .enum(['checkbox', 'chips'])
        .default('checkbox')
        .describe('The display style of the component.')
        .optional(),
      filterable: z
        .boolean()
        .default(false)
        .describe('If true, displays a search input to filter the options.')
        .optional(),
      checks: CheckableSchema.shape.checks,
    })
    .strict()
    .describe('A component that allows selecting one or more options from a list.'),
} satisfies ComponentApi;

export const SliderApi = {
  name: 'Slider',
  schema: z
    .object({
      ...CommonProps,
      label: DynamicStringSchema.describe('The label for the slider.').optional(),
      min: z.number().default(0).describe('The minimum value of the slider.').optional(),
      max: z.number().describe('The maximum value of the slider.'),
      step: z.number().describe('The granularity or step size of the slider.').optional(),
      value: DynamicNumberSchema.describe('The current value of the slider.'),
      checks: CheckableSchema.shape.checks,
    })
    .strict(),
} satisfies ComponentApi;

export const DateTimeInputApi = {
  name: 'DateTimeInput',
  schema: z
    .object({
      ...CommonProps,
      value: DynamicStringSchema.describe(
        'The selected date and/or time value in ISO 8601 format. If not yet set, initialize with an empty string.',
      ),
      enableDate: z
        .boolean()
        .default(false)
        .describe('If true, allows the user to select a date.')
        .optional(),
      enableTime: z
        .boolean()
        .default(false)
        .describe('If true, allows the user to select a time.')
        .optional(),
      min: z
        .union([DynamicStringSchema, z.string().date(), z.string().time(), z.string().datetime()])
        .describe('The minimum allowed date/time in ISO 8601 format.')
        .optional(),
      max: z
        .union([DynamicStringSchema, z.string().date(), z.string().time(), z.string().datetime()])
        .describe('The maximum allowed date/time in ISO 8601 format.')
        .optional(),
      label: DynamicStringSchema.describe('The text label for the input field.').optional(),
      checks: CheckableSchema.shape.checks,
    })
    .strict(),
} satisfies ComponentApi;

export const BASIC_COMPONENTS: ComponentApi[] = [
  TextApi,
  ImageApi,
  IconApi,
  VideoApi,
  AudioPlayerApi,
  RowApi,
  ColumnApi,
  ListApi,
  CardApi,
  TabsApi,
  ModalApi,
  DividerApi,
  ButtonApi,
  TextFieldApi,
  CheckBoxApi,
  ChoicePickerApi,
  SliderApi,
  DateTimeInputApi,
];
