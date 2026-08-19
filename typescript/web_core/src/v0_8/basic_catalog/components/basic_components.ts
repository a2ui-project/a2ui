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
} from '../../../v0_9/basic_catalog/components/basic_components.js';
import {
  DynamicStringSchema,
  AccessibilityAttributesSchema,
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

export {
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
