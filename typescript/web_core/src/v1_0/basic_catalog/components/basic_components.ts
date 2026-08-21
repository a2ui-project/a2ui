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
import {
  ImageApi,
  IconApi,
  AudioPlayerApi,
  RowApi,
  ColumnApi,
  ListApi,
  CardApi,
  TabsApi,
  ModalApi,
  DividerApi,
  ButtonApi,
  CheckBoxApi,
  ChoicePickerApi,
  DateTimeInputApi,
} from '../../../v0_9/basic_catalog/components/basic_components.js';
import {
  DynamicStringSchema,
  DynamicNumberSchema,
  AccessibilityAttributesSchema,
  CheckableSchema,
} from '../../../v0_9/schema/common-types.js';

const CommonProps = {
  'accessibility': AccessibilityAttributesSchema.optional(),
  'weight': z
    .number()
    .describe('The relative weight of this component within a Row or Column.')
    .optional(),
};

export const TextApi: ComponentApi = {
  name: 'Text',
  schema: z
    .object({
      ...CommonProps,
      'text': DynamicStringSchema.describe('The text content to display.'),
      'variant': z
        .enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'])
        .default('body')
        .describe('A hint for the base text style.')
        .optional(),
    })
    .strict(),
};

export const VideoApi: ComponentApi = {
  name: 'Video',
  schema: z
    .object({
      ...CommonProps,
      'url': DynamicStringSchema.describe('The URL of the video to display.'),
      'posterUrl': DynamicStringSchema.describe(
        'The URL of the poster image to display before playing.',
      ).optional(),
    })
    .strict(),
};

export const TextFieldApi: ComponentApi = {
  name: 'TextField',
  schema: z
    .object({
      ...CommonProps,
      'label': DynamicStringSchema.describe('The text label for the input field.'),
      'value': DynamicStringSchema.describe('The value of the text field.').optional(),
      'placeholder': DynamicStringSchema.describe(
        'The placeholder text for the input field.',
      ).optional(),
      'variant': z
        .enum(['longText', 'number', 'shortText', 'obscured'])
        .default('shortText')
        .describe('The type of input field to display.')
        .optional(),
      'validationRegexp': z
        .string()
        .describe('A regular expression used for validation of the input.')
        .optional(),
      ...CheckableSchema.shape,
    })
    .strict(),
};

export const SliderApi: ComponentApi = {
  name: 'Slider',
  schema: z
    .object({
      ...CommonProps,
      'label': DynamicStringSchema.describe('The label for the slider.').optional(),
      'min': z.number().default(0).describe('The minimum value of the slider.').optional(),
      'max': z.number().describe('The maximum value of the slider.'),
      'steps': z.number().describe('The number of discrete step intervals.').optional(),
      'value': DynamicNumberSchema.describe('The current value of the slider.'),
      ...CheckableSchema.shape,
    })
    .strict(),
};

export {
  ImageApi,
  IconApi,
  AudioPlayerApi,
  RowApi,
  ColumnApi,
  ListApi,
  CardApi,
  TabsApi,
  ModalApi,
  DividerApi,
  ButtonApi,
  CheckBoxApi,
  ChoicePickerApi,
  DateTimeInputApi,
};

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
