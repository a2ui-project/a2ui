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
// Generated from specification/v0_8/json/standard_catalog_definition.json via
// src/v0_8/scripts/generate-catalog.mjs
import {z} from 'zod';

import {spec} from '../../../catalog/spec_annotations.js';
import {CatalogDocumentOptions, ComponentApi} from '../../../catalog/types.js';

export const TextApi = {
  name: 'Text',
  schema: spec(
    z
      .object({
        'text': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The text content to display. This can be a literal string or a reference to a value in the data model ('path', e.g., '/doc/title'). While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.",
            ),
          {closure: 'additionalProperties'},
        ),
        'usageHint': z
          .enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'])
          .describe(
            'A hint for the base text style. One of:\n- `h1`: Largest heading.\n- `h2`: Second largest heading.\n- `h3`: Third largest heading.\n- `h4`: Fourth largest heading.\n- `h5`: Fifth largest heading.\n- `caption`: Small text for captions.\n- `body`: Standard body text.',
          )
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const ImageApi = {
  name: 'Image',
  schema: spec(
    z
      .object({
        'url': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The URL of the image to display. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/url').",
            ),
          {closure: 'additionalProperties'},
        ),
        'altText': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The alt text for the image. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/altText').",
            ),
          {closure: 'additionalProperties'},
        ).optional(),
        'fit': z
          .enum(['contain', 'cover', 'fill', 'none', 'scale-down'])
          .describe(
            "Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
          )
          .optional(),
        'usageHint': z
          .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
          .describe(
            'A hint for the image size and style. One of:\n- `icon`: Small square icon.\n- `avatar`: Circular avatar image.\n- `smallFeature`: Small feature image.\n- `mediumFeature`: Medium feature image.\n- `largeFeature`: Large feature image.\n- `header`: Full-width, full bleed, header image.',
          )
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const IconApi = {
  name: 'Icon',
  schema: spec(
    z
      .object({
        'name': spec(
          z
            .object({
              'literalString': z
                .enum([
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
                  'payment',
                  'person',
                  'phone',
                  'photo',
                  'print',
                  'refresh',
                  'search',
                  'send',
                  'settings',
                  'share',
                  'shoppingCart',
                  'star',
                  'starHalf',
                  'starOff',
                  'upload',
                  'visibility',
                  'visibilityOff',
                  'warning',
                ])
                .optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The name of the icon to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/form/submit').",
            ),
          {closure: 'additionalProperties'},
        ),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const VideoApi = {
  name: 'Video',
  schema: spec(
    z
      .object({
        'url': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The URL of the video to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/video/url').",
            ),
          {closure: 'additionalProperties'},
        ),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const AudioPlayerApi = {
  name: 'AudioPlayer',
  schema: spec(
    z
      .object({
        'url': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The URL of the audio to be played. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/song/url').",
            ),
          {closure: 'additionalProperties'},
        ),
        'description': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "A description of the audio, such as a title or summary. This can be a literal string or a reference to a value in the data model ('path', e.g. '/song/title').",
            ),
          {closure: 'additionalProperties'},
        ).optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const RowApi = {
  name: 'Row',
  schema: spec(
    z
      .object({
        'children': spec(
          z
            .object({
              'explicitList': z.array(z.string()).optional(),
              'template': spec(
                z
                  .object({
                    'componentId': z.string(),
                    'dataBinding': z.string(),
                  })
                  .describe(
                    'A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.',
                  ),
                {closure: 'additionalProperties'},
              ).optional(),
            })
            .describe(
              "Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.",
            ),
          {closure: 'additionalProperties'},
        ),
        'distribution': z
          .enum(['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly', 'start'])
          .describe(
            "Defines the arrangement of children along the main axis (horizontally). This corresponds to the CSS 'justify-content' property.",
          )
          .optional(),
        'alignment': z
          .enum(['start', 'center', 'end', 'stretch'])
          .describe(
            "Defines the alignment of children along the cross axis (vertically). This corresponds to the CSS 'align-items' property.",
          )
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const ColumnApi = {
  name: 'Column',
  schema: spec(
    z
      .object({
        'children': spec(
          z
            .object({
              'explicitList': z.array(z.string()).optional(),
              'template': spec(
                z
                  .object({
                    'componentId': z.string(),
                    'dataBinding': z.string(),
                  })
                  .describe(
                    'A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.',
                  ),
                {closure: 'additionalProperties'},
              ).optional(),
            })
            .describe(
              "Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.",
            ),
          {closure: 'additionalProperties'},
        ),
        'distribution': z
          .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly'])
          .describe(
            "Defines the arrangement of children along the main axis (vertically). This corresponds to the CSS 'justify-content' property.",
          )
          .optional(),
        'alignment': z
          .enum(['center', 'end', 'start', 'stretch'])
          .describe(
            "Defines the alignment of children along the cross axis (horizontally). This corresponds to the CSS 'align-items' property.",
          )
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const ListApi = {
  name: 'List',
  schema: spec(
    z
      .object({
        'children': spec(
          z
            .object({
              'explicitList': z.array(z.string()).optional(),
              'template': spec(
                z
                  .object({
                    'componentId': z.string(),
                    'dataBinding': z.string(),
                  })
                  .describe(
                    'A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.',
                  ),
                {closure: 'additionalProperties'},
              ).optional(),
            })
            .describe(
              "Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list.",
            ),
          {closure: 'additionalProperties'},
        ),
        'direction': z
          .enum(['vertical', 'horizontal'])
          .describe('The direction in which the list items are laid out.')
          .optional(),
        'alignment': z
          .enum(['start', 'center', 'end', 'stretch'])
          .describe('Defines the alignment of children along the cross axis.')
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const CardApi = {
  name: 'Card',
  schema: spec(
    z
      .object({
        'child': z.string().describe('The ID of the component to be rendered inside the card.'),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const TabsApi = {
  name: 'Tabs',
  schema: spec(
    z
      .object({
        'tabItems': z
          .array(
            spec(
              z.object({
                'title': spec(
                  z
                    .object({
                      'literalString': z.string().optional(),
                      'path': z.string().optional(),
                    })
                    .describe(
                      "The tab title. Defines the value as either a literal value or a path to data model value (e.g. '/options/title').",
                    ),
                  {closure: 'additionalProperties'},
                ),
                'child': z.string(),
              }),
              {closure: 'additionalProperties'},
            ),
          )
          .describe(
            'An array of objects, where each object defines a tab with a title and a child component.',
          ),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const DividerApi = {
  name: 'Divider',
  schema: spec(
    z
      .object({
        'axis': z
          .enum(['horizontal', 'vertical'])
          .describe('The orientation of the divider.')
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const ModalApi = {
  name: 'Modal',
  schema: spec(
    z
      .object({
        'entryPointChild': z
          .string()
          .describe(
            'The ID of the component that opens the modal when interacted with (e.g., a button).',
          ),
        'contentChild': z
          .string()
          .describe('The ID of the component to be displayed inside the modal.'),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const ButtonApi = {
  name: 'Button',
  schema: spec(
    z
      .object({
        'child': z
          .string()
          .describe(
            'The ID of the component to display in the button, typically a Text component.',
          ),
        'primary': z
          .boolean()
          .describe('Indicates if this button should be styled as the primary action.')
          .optional(),
        'action': spec(
          z
            .object({
              'name': z.string(),
              'context': z
                .array(
                  spec(
                    z.object({
                      'key': z.string(),
                      'value': spec(
                        z
                          .object({
                            'path': z.string().optional(),
                            'literalString': z.string().optional(),
                            'literalNumber': z.number().optional(),
                            'literalBoolean': z.boolean().optional(),
                          })
                          .describe(
                            "Defines the value to be included in the context as either a literal value or a path to a data model value (e.g. '/user/name').",
                          ),
                        {closure: 'additionalProperties'},
                      ),
                    }),
                    {closure: 'additionalProperties'},
                  ),
                )
                .optional(),
            })
            .describe(
              "The client-side action to be dispatched when the button is clicked. It includes the action's name and an optional context payload.",
            ),
          {closure: 'additionalProperties'},
        ),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const CheckBoxApi = {
  name: 'CheckBox',
  schema: spec(
    z
      .object({
        'label': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The text to display next to the checkbox. Defines the value as either a literal value or a path to data model ('path', e.g. '/option/label').",
            ),
          {closure: 'additionalProperties'},
        ),
        'value': spec(
          z
            .object({
              'literalBoolean': z.boolean().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The current state of the checkbox (true for checked, false for unchecked). This can be a literal boolean ('literalBoolean') or a reference to a value in the data model ('path', e.g. '/filter/open').",
            ),
          {closure: 'additionalProperties'},
        ),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const TextFieldApi = {
  name: 'TextField',
  schema: spec(
    z
      .object({
        'label': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The text label for the input field. This can be a literal string or a reference to a value in the data model ('path, e.g. '/user/name').",
            ),
          {closure: 'additionalProperties'},
        ),
        'text': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The value of the text field. This can be a literal string or a reference to a value in the data model ('path', e.g. '/user/name').",
            ),
          {closure: 'additionalProperties'},
        ).optional(),
        'textFieldType': z
          .enum(['date', 'longText', 'number', 'shortText', 'obscured'])
          .describe('The type of input field to display.')
          .optional(),
        'validationRegexp': z
          .string()
          .describe('A regular expression used for client-side validation of the input.')
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const DateTimeInputApi = {
  name: 'DateTimeInput',
  schema: spec(
    z
      .object({
        'value': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The selected date and/or time value in ISO 8601 format. This can be a literal string ('literalString') or a reference to a value in the data model ('path', e.g. '/user/dob').",
            ),
          {closure: 'additionalProperties'},
        ),
        'enableDate': z.boolean().describe('If true, allows the user to select a date.').optional(),
        'enableTime': z.boolean().describe('If true, allows the user to select a time.').optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const MultipleChoiceApi = {
  name: 'MultipleChoice',
  schema: spec(
    z
      .object({
        'selections': spec(
          z
            .object({
              'literalArray': z.array(z.string()).optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The currently selected values for the component. This can be a literal array of strings or a path to an array in the data model('path', e.g. '/hotel/options').",
            ),
          {closure: 'additionalProperties'},
        ),
        'options': z
          .array(
            spec(
              z.object({
                'label': spec(
                  z
                    .object({
                      'literalString': z.string().optional(),
                      'path': z.string().optional(),
                    })
                    .describe(
                      "The text to display for this option. This can be a literal string or a reference to a value in the data model (e.g. '/option/label').",
                    ),
                  {closure: 'additionalProperties'},
                ),
                'value': z
                  .string()
                  .describe('The value to be associated with this option when selected.'),
              }),
              {closure: 'additionalProperties'},
            ),
          )
          .describe('An array of available options for the user to choose from.'),
        'maxAllowedSelections': z
          .number()
          .int()
          .describe('The maximum number of options that the user is allowed to select.')
          .optional(),
        'variant': z
          .enum(['checkbox', 'chips'])
          .describe('The display style of the component.')
          .optional(),
        'filterable': z
          .boolean()
          .describe('If true, displays a search input to filter the options.')
          .optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

export const SliderApi = {
  name: 'Slider',
  schema: spec(
    z
      .object({
        'label': spec(
          z
            .object({
              'literalString': z.string().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The label for the slider. This can be a literal string or a reference to a value in the data model ('path').",
            ),
          {closure: 'additionalProperties'},
        ).optional(),
        'value': spec(
          z
            .object({
              'literalNumber': z.number().optional(),
              'path': z.string().optional(),
            })
            .describe(
              "The current value of the slider. This can be a literal number ('literalNumber') or a reference to a value in the data model ('path', e.g. '/restaurant/cost').",
            ),
          {closure: 'additionalProperties'},
        ),
        'minValue': z.number().describe('The minimum value of the slider.').optional(),
        'maxValue': z.number().describe('The maximum value of the slider.').optional(),
      })
      .strict(),
    {mixins: []},
  ),
} satisfies ComponentApi;

/**
 * The theme of the v0.8 basic catalog, which its document declares under
 * `styles`.
 */
export const ThemeSchema = spec(
  z
    .object({
      'font': z.string().describe('The primary font for the UI.').optional(),
      'primaryColor': z
        .string()
        .regex(new RegExp('^#[0-9a-fA-F]{6}$'))
        .describe("The primary UI color as a hexadecimal code (e.g., '#00BFFF').")
        .optional(),
    })
    .strict(),
  {closure: 'none'},
);

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
  DividerApi,
  ModalApi,
  ButtonApi,
  CheckBoxApi,
  TextFieldApi,
  DateTimeInputApi,
  MultipleChoiceApi,
  SliderApi,
];

/**
 * The document-level fields of the published catalog document, which
 * declares neither a protocol version nor a catalog ID, writes its theme
 * under `styles` and has no `$defs`.
 */
export const BASIC_CATALOG_DOCUMENT_OPTIONS = {
  declaredProtocolVersion: null,
  declaresCatalogId: false,
  unions: {anyComponent: false, anyFunction: false},
  themeLocation: 'styles',
} satisfies CatalogDocumentOptions;
