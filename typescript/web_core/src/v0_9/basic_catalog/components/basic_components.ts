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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/ catalogs via scripts/generate-catalog-schemas.mjs
import {z} from 'zod';

import {spec, specDef} from '../../../catalog/spec_annotations.js';
import {CatalogDocumentOptions, ComponentApi} from '../../../catalog/types.js';
import {
  AccessibilityAttributesSchema,
  ActionSchema,
  CheckRuleSchema,
  ChildListSchema,
  ComponentIdSchema,
  DataBindingSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringListSchema,
  DynamicStringSchema,
} from '../../schema/common-types.js';

export const CatalogComponentCommonSchema = specDef(
  'CatalogComponentCommon',
  z.object({
    'weight': z
      .number()
      .describe(
        "The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column.",
      )
      .optional(),
  }),
);

export const ThemeDefSchema = specDef(
  'theme',
  z.object({
    'primaryColor': z
      .string()
      .regex(new RegExp('^#[0-9a-fA-F]{6}$'))
      .describe(
        "The primary brand color used for highlights (e.g., primary buttons, active borders). Renderers may generate variants of this color for different contexts. Format: Hexadecimal code (e.g., '#00BFFF').",
      )
      .optional(),
    'iconUrl': spec(
      z
        .string()
        .describe(
          'A URL for an image that identifies the agent or tool associated with the surface.',
        ),
      {keywords: {format: 'uri'}},
    ).optional(),
    'agentDisplayName': z
      .string()
      .describe(
        'Text to be displayed next to the surface to identify the agent or tool that created it.',
      )
      .optional(),
  }),
  {keywords: {additionalProperties: true}},
);

export const TextApi = {
  name: 'Text',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'text': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The text content to display. While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.',
        ),
        'variant': z
          .enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'])
          .default('body')
          .describe('A hint for the base text style.')
          .optional(),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const ImageApi = {
  name: 'Image',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'url': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The URL of the image to display.',
        ),
        'description': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|Accessibility text for the image.',
        ).optional(),
        'fit': z
          .enum(['contain', 'cover', 'fill', 'none', 'scaleDown'])
          .default('fill')
          .describe(
            "Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
          )
          .optional(),
        'variant': z
          .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
          .default('mediumFeature')
          .describe('A hint for the image size and style.')
          .optional(),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const IconApi = {
  name: 'Icon',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'name': z
          .union([
            z.enum([
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
            ]),
            spec(
              z.object({
                'svgPath': z.string(),
              }),
              {closure: 'additionalProperties'},
            ),
            DataBindingSchema.describe('REF:#/$defs/DataBinding'),
          ])
          .describe('The name of the icon to display.'),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const VideoApi = {
  name: 'Video',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'url': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The URL of the video to display.',
        ),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const AudioPlayerApi = {
  name: 'AudioPlayer',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'url': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The URL of the audio to be played.',
        ),
        'description': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|A description of the audio, such as a title or summary.',
        ).optional(),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const RowApi = {
  name: 'Row',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'children': ChildListSchema.describe(
          'REF:#/$defs/ChildList|Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.',
        ),
        'justify': z
          .enum(['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly', 'start', 'stretch'])
          .default('start')
          .describe(
            "Defines the arrangement of children along the main axis (horizontally). Use 'spaceBetween' to push items to the edges, or 'start'/'end'/'center' to pack them together.",
          )
          .optional(),
        'align': z
          .enum(['start', 'center', 'end', 'stretch'])
          .default('stretch')
          .describe(
            "Defines the alignment of children along the cross axis (vertically). This is similar to the CSS 'align-items' property, but uses camelCase values (e.g., 'start').",
          )
          .optional(),
      })
      .describe(
        'A layout component that arranges its children horizontally. To create a grid layout, nest Columns within this Row.',
      )
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const ColumnApi = {
  name: 'Column',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'children': ChildListSchema.describe(
          'REF:#/$defs/ChildList|Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.',
        ),
        'justify': z
          .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'])
          .default('start')
          .describe(
            "Defines the arrangement of children along the main axis (vertically). Use 'spaceBetween' to push items to the edges (e.g. header at top, footer at bottom), or 'start'/'end'/'center' to pack them together.",
          )
          .optional(),
        'align': z
          .enum(['center', 'end', 'start', 'stretch'])
          .default('stretch')
          .describe(
            "Defines the alignment of children along the cross axis (horizontally). This is similar to the CSS 'align-items' property.",
          )
          .optional(),
      })
      .describe(
        'A layout component that arranges its children vertically. To create a grid layout, nest Rows within this Column.',
      )
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const ListApi = {
  name: 'List',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'children': ChildListSchema.describe(
          'REF:#/$defs/ChildList|Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list.',
        ),
        'direction': z
          .enum(['vertical', 'horizontal'])
          .default('vertical')
          .describe('The direction in which the list items are laid out.')
          .optional(),
        'align': z
          .enum(['start', 'center', 'end', 'stretch'])
          .default('stretch')
          .describe('Defines the alignment of children along the cross axis.')
          .optional(),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const CardApi = {
  name: 'Card',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'child': ComponentIdSchema.describe(
          "REF:#/$defs/ComponentId|The ID of the single child component to be rendered inside the card. To display multiple elements, you MUST wrap them in a layout component (like Column or Row) and pass that container's ID here. Do NOT pass multiple IDs or a non-existent ID.",
        ),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const TabsApi = {
  name: 'Tabs',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'tabs': z
          .array(
            spec(
              z.object({
                'title': DynamicStringSchema.describe('REF:#/$defs/DynamicString|The tab title.'),
                'child': ComponentIdSchema.describe(
                  'REF:#/$defs/ComponentId|The ID of the child component.',
                ),
              }),
              {closure: 'additionalProperties'},
            ),
          )
          .min(1)
          .describe(
            'An array of objects, where each object defines a tab with a title and a child component.',
          ),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const ModalApi = {
  name: 'Modal',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'trigger': ComponentIdSchema.describe(
          'REF:#/$defs/ComponentId|The ID of the component that opens the modal when interacted with (e.g., a button).',
        ),
        'content': ComponentIdSchema.describe(
          'REF:#/$defs/ComponentId|The ID of the component to be displayed inside the modal.',
        ),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const DividerApi = {
  name: 'Divider',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'axis': z
          .enum(['horizontal', 'vertical'])
          .default('horizontal')
          .describe('The orientation of the divider.')
          .optional(),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema]},
  ),
} satisfies ComponentApi;

export const ButtonApi = {
  name: 'Button',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'checks': z
          .array(CheckRuleSchema.describe('REF:#/$defs/CheckRule'))
          .describe(
            'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
          )
          .optional(),
        'child': ComponentIdSchema.describe(
          "REF:#/$defs/ComponentId|The ID of the child component. Use a 'Text' component for a labeled button. Only use an 'Icon' if the requirements explicitly ask for an icon-only button.",
        ),
        'variant': z
          .enum(['default', 'primary', 'borderless'])
          .default('default')
          .describe(
            "A hint for the button style. If omitted, a default button style is used. 'primary' indicates this is the main call-to-action button. 'borderless' means the button has no visual border or background, making its child content appear like a clickable link.",
          )
          .optional(),
        'action': ActionSchema.describe('REF:#/$defs/Action'),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema, 'Checkable']},
  ),
} satisfies ComponentApi;

export const TextFieldApi = {
  name: 'TextField',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'checks': z
          .array(CheckRuleSchema.describe('REF:#/$defs/CheckRule'))
          .describe(
            'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
          )
          .optional(),
        'label': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The text label for the input field.',
        ),
        'value': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The value of the text field.',
        ).optional(),
        'variant': z
          .enum(['longText', 'number', 'shortText', 'obscured'])
          .default('shortText')
          .describe('The type of input field to display.')
          .optional(),
        'validationRegexp': z
          .string()
          .describe('A regular expression used for client-side validation of the input.')
          .optional(),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema, 'Checkable']},
  ),
} satisfies ComponentApi;

export const CheckBoxApi = {
  name: 'CheckBox',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'checks': z
          .array(CheckRuleSchema.describe('REF:#/$defs/CheckRule'))
          .describe(
            'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
          )
          .optional(),
        'label': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The text to display next to the checkbox.',
        ),
        'value': DynamicBooleanSchema.describe(
          'REF:#/$defs/DynamicBoolean|The current state of the checkbox (true for checked, false for unchecked).',
        ),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema, 'Checkable']},
  ),
} satisfies ComponentApi;

export const ChoicePickerApi = {
  name: 'ChoicePicker',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'checks': z
          .array(CheckRuleSchema.describe('REF:#/$defs/CheckRule'))
          .describe(
            'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
          )
          .optional(),
        'label': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The label for the group of options.',
        ).optional(),
        'variant': z
          .enum(['multipleSelection', 'mutuallyExclusive'])
          .default('mutuallyExclusive')
          .describe('A hint for how the choice picker should be displayed and behave.')
          .optional(),
        'options': z
          .array(
            spec(
              z.object({
                'label': DynamicStringSchema.describe(
                  'REF:#/$defs/DynamicString|The text to display for this option.',
                ),
                'value': z.string().describe('The stable value associated with this option.'),
              }),
              {closure: 'additionalProperties'},
            ),
          )
          .describe('The list of available options to choose from.'),
        'value': DynamicStringListSchema.describe(
          'REF:#/$defs/DynamicStringList|The list of currently selected values. This should be bound to a string array in the data model.',
        ),
        'displayStyle': z
          .enum(['checkbox', 'chips'])
          .default('checkbox')
          .describe('The display style of the component.')
          .optional(),
        'filterable': z
          .boolean()
          .default(false)
          .describe('If true, displays a search input to filter the options.')
          .optional(),
      })
      .describe('A component that allows selecting one or more options from a list.')
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema, 'Checkable']},
  ),
} satisfies ComponentApi;

export const SliderApi = {
  name: 'Slider',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'checks': z
          .array(CheckRuleSchema.describe('REF:#/$defs/CheckRule'))
          .describe(
            'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
          )
          .optional(),
        'label': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The label for the slider.',
        ).optional(),
        'min': z.number().default(0).describe('The minimum value of the slider.').optional(),
        'max': z.number().describe('The maximum value of the slider.'),
        'value': DynamicNumberSchema.describe(
          'REF:#/$defs/DynamicNumber|The current value of the slider.',
        ),
      })
      .strict(),
    {
      mixins: ['ComponentCommon', CatalogComponentCommonSchema, 'Checkable'],
      required: ['value', 'max'],
    },
  ),
} satisfies ComponentApi;

export const DateTimeInputApi = {
  name: 'DateTimeInput',
  schema: spec(
    z
      .object({
        ...CatalogComponentCommonSchema.shape,
        'accessibility': AccessibilityAttributesSchema.describe(
          'REF:#/$defs/AccessibilityAttributes',
        ).optional(),
        'checks': z
          .array(CheckRuleSchema.describe('REF:#/$defs/CheckRule'))
          .describe(
            'A list of checks to perform. These are function calls that must return a boolean indicating validity.',
          )
          .optional(),
        'value': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The selected date and/or time value in ISO 8601 format. If not yet set, initialize with an empty string.',
        ),
        'enableDate': z
          .boolean()
          .default(false)
          .describe('If true, allows the user to select a date.')
          .optional(),
        'enableTime': z
          .boolean()
          .default(false)
          .describe('If true, allows the user to select a time.')
          .optional(),
        'min': spec(
          DynamicStringSchema.describe(
            'REF:#/$defs/DynamicString|The minimum allowed date/time in ISO 8601 format.',
          ),
          {
            allOf: [
              {
                if: {type: 'string'},
                then: {oneOf: [{format: 'date'}, {format: 'time'}, {format: 'date-time'}]},
              },
            ],
          },
        ).optional(),
        'max': spec(
          DynamicStringSchema.describe(
            'REF:#/$defs/DynamicString|The maximum allowed date/time in ISO 8601 format.',
          ),
          {
            allOf: [
              {
                if: {type: 'string'},
                then: {oneOf: [{format: 'date'}, {format: 'time'}, {format: 'date-time'}]},
              },
            ],
          },
        ).optional(),
        'label': DynamicStringSchema.describe(
          'REF:#/$defs/DynamicString|The text label for the input field.',
        ).optional(),
      })
      .strict(),
    {mixins: ['ComponentCommon', CatalogComponentCommonSchema, 'Checkable']},
  ),
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

/**
 * The document-level fields of the published catalog document.
 */
export const BASIC_CATALOG_DOCUMENT_OPTIONS = {
  schemaUri: 'https://json-schema.org/draft/2020-12/schema',
  schemaId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  title: 'A2UI Basic Catalog',
  description: 'Unified catalog of basic A2UI components and functions.',
  declaredProtocolVersion: null,
  commonTypesUri: 'https://a2ui.org/specification/v0_9/common_types.json',
  defModels: [ThemeDefSchema],
} satisfies CatalogDocumentOptions;
