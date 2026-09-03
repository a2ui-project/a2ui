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
import {ComponentApi} from '../../../catalog/types.js';

const TextItemSchema = z
  .object({
    literalString: z.string().optional(),
    path: z.string().optional(),
  })
  .describe(
    "REF:#/$defs/TextItem|The text content to display. This can be a literal string or a reference to a value in the data model ('path', e.g., '/doc/title'). While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.",
  );

const UrlItemSchema = z
  .object({
    literalString: z.string().optional(),
    path: z.string().optional(),
  })
  .describe(
    "REF:#/$defs/UrlItem|The URL of the image to display. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/url').",
  );

const AltTextItemSchema = z
  .object({
    literalString: z.string().optional(),
    path: z.string().optional(),
  })
  .describe(
    "REF:#/$defs/AltTextItem|The alt text for the image. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/altText').",
  );

const V08_ICON_NAMES = [
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
] as const;

const NameItemSchema = z
  .object({
    literalString: z.enum(V08_ICON_NAMES).optional(),
    path: z.string().optional(),
  })
  .describe(
    "REF:#/$defs/NameItem|The name of the icon to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/form/submit').",
  );

const DescriptionItemSchema = z
  .object({
    literalString: z.string().optional(),
    path: z.string().optional(),
  })
  .describe(
    "REF:#/$defs/DescriptionItem|A description of the audio, such as a title or summary. This can be a literal string or a reference to a value in the data model ('path', e.g. '/song/title').",
  );

const ChildrenItemSchema = z
  .object({
    explicitList: z.array(z.string()).optional(),
    template: z
      .object({
        componentId: z.string(),
        dataBinding: z.string(),
      })
      .describe(
        'A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children.',
      )
      .optional(),
  })
  .describe('REF:#/$defs/ChildrenItem');

const TabItemItemSchema = z
  .object({
    title: z.object({
      literalString: z.string().optional(),
      path: z.string().optional(),
    }),
    child: z.string(),
  })
  .describe('REF:#/$defs/TabItemItem');

const ValueItemSchema = z
  .object({
    literalBoolean: z.boolean().optional(),
    literalNumber: z.number().optional(),
    literalString: z.string().optional(),
    path: z.string().optional(),
  })
  .describe('REF:#/$defs/ValueItem');

const LabelItemSchema = z
  .object({
    literalString: z.string().optional(),
    path: z.string().optional(),
  })
  .describe(
    "REF:#/$defs/LabelItem|The label for the slider. This can be a literal string or a reference to a value in the data model ('path').",
  );

const ActionItemSchema = z
  .object({
    name: z.string(),
    context: z
      .array(
        z.object({
          key: z.string(),
          value: ValueItemSchema.describe(
            "REF:#/$defs/ValueItem|Defines the value to be included in the context as either a literal value or a path to a data model value (e.g. '/user/name').",
          ),
        }),
      )
      .optional(),
  })
  .describe('REF:#/$defs/ActionItem');

const OptionItemSchema = z
  .object({
    label: LabelItemSchema.describe(
      "REF:#/$defs/LabelItem|The text to display for this option. This can be a literal string or a reference to a value in the data model (e.g. '/option/label').",
    ),
    value: z.string().describe('The value to be associated with this option when selected.'),
  })
  .describe('REF:#/$defs/OptionItem');

const SelectionItemSchema = z
  .object({
    literalArray: z.array(z.string()).optional(),
    path: z.string().optional(),
  })
  .describe('REF:#/$defs/SelectionItem');

export const TextApi: ComponentApi = {
  name: 'Text',
  schema: z
    .object({
      text: TextItemSchema,
      usageHint: z
        .enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'])
        .describe(
          'A hint for the base text style. One of: - `h1`: Largest heading. - `h2`: Second largest heading. - `h3`: Third largest heading. - `h4`: Fourth largest heading. - `h5`: Fifth largest heading. - `caption`: Small text for captions. - `body`: Standard body text.',
        )
        .optional(),
    })
    .strict(),
};

export const ImageApi: ComponentApi = {
  name: 'Image',
  schema: z
    .object({
      url: UrlItemSchema,
      altText: AltTextItemSchema.optional(),
      fit: z
        .enum(['contain', 'cover', 'fill', 'none', 'scale-down'])
        .describe(
          "Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
        )
        .optional(),
      usageHint: z
        .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
        .describe(
          'A hint for the image size and style. One of: - `icon`: Small square icon. - `avatar`: Circular avatar image. - `smallFeature`: Small feature image. - `mediumFeature`: Medium feature image. - `largeFeature`: Large feature image. - `header`: Full-width, full bleed, header image.',
        )
        .optional(),
    })
    .strict(),
};

export const IconApi: ComponentApi = {
  name: 'Icon',
  schema: z
    .object({
      name: NameItemSchema.describe('REF:#/$defs/NameItem'),
    })
    .strict(),
};

export const VideoApi: ComponentApi = {
  name: 'Video',
  schema: z
    .object({
      url: UrlItemSchema.describe(
        "REF:#/$defs/UrlItem|The URL of the video to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/video/url').",
      ),
    })
    .strict(),
};

export const AudioPlayerApi: ComponentApi = {
  name: 'AudioPlayer',
  schema: z
    .object({
      url: UrlItemSchema.describe('REF:#/$defs/UrlItem'),
      description: DescriptionItemSchema.optional(),
    })
    .strict(),
};

export const RowApi: ComponentApi = {
  name: 'Row',
  schema: z
    .object({
      children: ChildrenItemSchema,
      distribution: z
        .enum(['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly', 'start'])
        .describe(
          "Defines the arrangement of children along the main axis (horizontally). This corresponds to the CSS 'justify-content' property.",
        )
        .optional(),
      alignment: z
        .enum(['start', 'center', 'end', 'stretch'])
        .describe(
          "Defines the alignment of children along the cross axis (vertically). This corresponds to the CSS 'align-items' property.",
        )
        .optional(),
    })
    .strict(),
};

export const ColumnApi: ComponentApi = {
  name: 'Column',
  schema: z
    .object({
      children: ChildrenItemSchema,
      distribution: z
        .enum(['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly', 'start'])
        .describe(
          "Defines the arrangement of children along the main axis (vertically). This corresponds to the CSS 'justify-content' property.",
        )
        .optional(),
      alignment: z
        .enum(['start', 'center', 'end', 'stretch'])
        .describe(
          "Defines the alignment of children along the cross axis (horizontally). This corresponds to the CSS 'align-items' property.",
        )
        .optional(),
    })
    .strict(),
};

export const ListApi: ComponentApi = {
  name: 'List',
  schema: z
    .object({
      children: ChildrenItemSchema,
      direction: z
        .enum(['vertical', 'horizontal'])
        .describe('The direction in which the list items are laid out.')
        .optional(),
      alignment: z
        .enum(['start', 'center', 'end', 'stretch'])
        .describe('Defines the alignment of children along the cross axis.')
        .optional(),
    })
    .strict(),
};

export const CardApi: ComponentApi = {
  name: 'Card',
  schema: z
    .object({
      child: z.string().describe('The ID of the component to be rendered inside the card.'),
    })
    .strict(),
};

export const TabsApi: ComponentApi = {
  name: 'Tabs',
  schema: z
    .object({
      tabItems: z
        .array(TabItemItemSchema)
        .describe(
          'An array of objects, where each object defines a tab with a title and a child component.',
        ),
    })
    .strict(),
};

export const DividerApi: ComponentApi = {
  name: 'Divider',
  schema: z
    .object({
      axis: z
        .enum(['vertical', 'horizontal'])
        .describe('The orientation of the divider.')
        .optional(),
    })
    .strict(),
};

export const ModalApi: ComponentApi = {
  name: 'Modal',
  schema: z
    .object({
      entryPointChild: z
        .string()
        .describe(
          'The ID of the component that opens the modal when interacted with (e.g., a button).',
        ),
      contentChild: z
        .string()
        .describe('The ID of the component to be displayed inside the modal.'),
    })
    .strict(),
};

export const ButtonApi: ComponentApi = {
  name: 'Button',
  schema: z
    .object({
      child: z
        .string()
        .describe('The ID of the component to display in the button, typically a Text component.'),
      primary: z
        .boolean()
        .describe('Indicates if this button should be styled as the primary action.')
        .optional(),
      action: ActionItemSchema,
    })
    .strict(),
};

export const CheckBoxApi: ComponentApi = {
  name: 'CheckBox',
  schema: z
    .object({
      label: LabelItemSchema.describe(
        "REF:#/$defs/LabelItem|The text to display next to the checkbox. Defines the value as either a literal value or a path to data model ('path', e.g. '/option/label').",
      ),
      value: ValueItemSchema.describe(
        "REF:#/$defs/ValueItem|The current state of the checkbox (true for checked, false for unchecked). This can be a literal boolean ('literalBoolean') or a reference to a value in the data model ('path', e.g. '/filter/open').",
      ),
    })
    .strict(),
};

export const TextFieldApi: ComponentApi = {
  name: 'TextField',
  schema: z
    .object({
      label: LabelItemSchema.describe(
        "REF:#/$defs/LabelItem|The text label for the input field. This can be a literal string or a reference to a value in the data model ('path, e.g. '/user/name').",
      ),
      text: TextItemSchema.describe(
        "REF:#/$defs/TextItem|The value of the text field. This can be a literal string or a reference to a value in the data model ('path', e.g. '/user/name').",
      ).optional(),
      textFieldType: z
        .enum(['date', 'longText', 'number', 'shortText', 'obscured'])
        .describe('The type of input field to display.')
        .optional(),
      validationRegexp: z
        .string()
        .describe('A regular expression used for client-side validation of the input.')
        .optional(),
    })
    .strict(),
};

export const DateTimeInputApi: ComponentApi = {
  name: 'DateTimeInput',
  schema: z
    .object({
      value: ValueItemSchema.describe(
        "REF:#/$defs/ValueItem|The selected date and/or time value in ISO 8601 format. This can be a literal string ('literalString') or a reference to a value in the data model ('path', e.g. '/user/dob').",
      ),
      enableDate: z.boolean().describe('If true, allows the user to select a date.').optional(),
      enableTime: z.boolean().describe('If true, allows the user to select a time.').optional(),
    })
    .strict(),
};

export const MultipleChoiceApi: ComponentApi = {
  name: 'MultipleChoice',
  schema: z
    .object({
      selections: SelectionItemSchema,
      options: z
        .array(OptionItemSchema)
        .describe('An array of available options for the user to choose from.'),
      maxAllowedSelections: z
        .number()
        .int()
        .describe('The maximum number of options that the user is allowed to select.')
        .optional(),
      variant: z
        .enum(['checkbox', 'chips'])
        .describe('The display style of the component.')
        .optional(),
      filterable: z
        .boolean()
        .describe('If true, displays a search input to filter the options.')
        .optional(),
    })
    .strict(),
};

export const SliderApi: ComponentApi = {
  name: 'Slider',
  schema: z
    .object({
      label: LabelItemSchema.describe(
        "REF:#/$defs/LabelItem|The label for the slider. This can be a literal string or a reference to a value in the data model ('path').",
      ).optional(),
      value: ValueItemSchema,
      minValue: z.number().describe('The minimum value of the slider.').optional(),
      maxValue: z.number().describe('The maximum value of the slider.').optional(),
    })
    .strict(),
};

export const ThemeSchema = z
  .object({
    font: z.string().describe('The primary font for the UI.').optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .describe("The primary UI color as a hexadecimal code (e.g., '#00BFFF').")
      .optional(),
  })
  .strict();

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
