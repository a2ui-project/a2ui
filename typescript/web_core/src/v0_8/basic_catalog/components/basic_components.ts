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
  IconApi,
  VideoApi,
  AudioPlayerApi,
  CardApi,
  DividerApi,
  ButtonApi,
  CheckBoxApi,
  ChoicePickerApi,
  DateTimeInputApi,
} from '../../../v0_9/basic_catalog/components/basic_components.js';
import {
  DynamicStringSchema,
  DynamicNumberSchema,
  ChildListSchema,
  ComponentIdSchema,
  AccessibilityAttributesSchema,
  CheckableSchema,
} from '../../../v0_9/schema/common-types.js';

const CommonProps = {
  'accessibility': AccessibilityAttributesSchema.optional(),
  'weight': z.number().optional(),
};

export const TextApi: ComponentApi = {
  name: 'Text',
  schema: z
    .object({
      ...CommonProps,
      'text': DynamicStringSchema,
      'variant': z
        .enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'])
        .default('body')
        .optional(),
      'usageHint': z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body']).optional(),
    })
    .strict(),
};

export const ImageApi: ComponentApi = {
  name: 'Image',
  schema: z
    .object({
      ...CommonProps,
      'url': DynamicStringSchema,
      'description': DynamicStringSchema.optional(),
      'altText': DynamicStringSchema.optional(),
      'fit': z
        .enum(['contain', 'cover', 'fill', 'none', 'scaleDown', 'scale-down'])
        .default('fill')
        .optional(),
      'variant': z
        .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
        .default('mediumFeature')
        .optional(),
      'usageHint': z
        .enum(['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'])
        .optional(),
    })
    .strict(),
};

export const RowApi: ComponentApi = {
  name: 'Row',
  schema: z
    .object({
      ...CommonProps,
      'children': ChildListSchema,
      'justify': z
        .enum(['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly', 'start', 'stretch'])
        .optional(),
      'distribution': z
        .enum(['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly', 'start', 'stretch'])
        .optional(),
      'align': z.enum(['start', 'center', 'end', 'stretch']).optional(),
      'alignment': z.enum(['start', 'center', 'end', 'stretch']).optional(),
    })
    .strict(),
};

export const ColumnApi: ComponentApi = {
  name: 'Column',
  schema: z
    .object({
      ...CommonProps,
      'children': ChildListSchema,
      'justify': z
        .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'])
        .optional(),
      'distribution': z
        .enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch'])
        .optional(),
      'align': z.enum(['center', 'end', 'start', 'stretch']).optional(),
      'alignment': z.enum(['center', 'end', 'start', 'stretch']).optional(),
    })
    .strict(),
};

export const ListApi: ComponentApi = {
  name: 'List',
  schema: z
    .object({
      ...CommonProps,
      'children': ChildListSchema,
      'direction': z.enum(['vertical', 'horizontal']).optional(),
      'align': z.enum(['start', 'center', 'end', 'stretch']).optional(),
      'alignment': z.enum(['start', 'center', 'end', 'stretch']).optional(),
      'listStyle': z.enum(['ordered', 'unordered', 'none']).optional(),
    })
    .strict(),
};

export const SliderApi: ComponentApi = {
  name: 'Slider',
  schema: z
    .object({
      ...CommonProps,
      'label': DynamicStringSchema.optional(),
      'min': z.number().optional(),
      'minValue': z.number().optional(),
      'max': z.number().optional(),
      'maxValue': z.number().optional(),
      'value': DynamicNumberSchema,
      ...CheckableSchema.shape,
    })
    .strict(),
};

export const TextFieldApi: ComponentApi = {
  name: 'TextField',
  schema: z
    .object({
      ...CommonProps,
      'label': DynamicStringSchema.optional(),
      'value': DynamicStringSchema.optional(),
      'text': DynamicStringSchema.optional(),
      'variant': z.enum(['longText', 'number', 'shortText', 'obscured']).optional(),
      'textFieldType': z.enum(['longText', 'number', 'shortText', 'obscured']).optional(),
      'validationRegexp': z.string().optional(),
      ...CheckableSchema.shape,
    })
    .strict(),
};

export const ModalApi: ComponentApi = {
  name: 'Modal',
  schema: z
    .object({
      ...CommonProps,
      'trigger': ComponentIdSchema.optional(),
      'entryPointChild': ComponentIdSchema.optional(),
      'content': ComponentIdSchema.optional(),
      'contentChild': ComponentIdSchema.optional(),
    })
    .strict(),
};

export const TabsApi: ComponentApi = {
  name: 'Tabs',
  schema: z
    .object({
      ...CommonProps,
      'tabs': z
        .array(
          z
            .object({
              'title': DynamicStringSchema,
              'child': ComponentIdSchema,
            })
            .strict(),
        )
        .optional(),
      'tabItems': z
        .array(
          z
            .object({
              'title': DynamicStringSchema,
              'child': ComponentIdSchema,
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
};

export const MultipleChoiceApi: ComponentApi = {
  name: 'MultipleChoice',
  schema: ChoicePickerApi.schema,
};

export {
  IconApi,
  VideoApi,
  AudioPlayerApi,
  CardApi,
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
  MultipleChoiceApi,
  SliderApi,
  DateTimeInputApi,
];
