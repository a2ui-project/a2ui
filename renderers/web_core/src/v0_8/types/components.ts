/*
 * Copyright 2025 Google LLC
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

import type {z} from 'zod';
import type {
  ActionSchema,
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
} from '../schema/common-types.js';

export declare interface Action extends z.infer<typeof ActionSchema> {}
export declare interface Text extends z.infer<typeof TextSchema> {}
export declare interface Image extends z.infer<typeof ImageSchema> {}
export declare interface Icon extends z.infer<typeof IconSchema> {}
export declare interface Video extends z.infer<typeof VideoSchema> {}
export declare interface AudioPlayer extends z.infer<typeof AudioPlayerSchema> {}
export declare interface Tabs extends z.infer<typeof TabsSchema> {}
export declare interface Row extends z.infer<typeof RowSchema> {}
export declare interface Column extends z.infer<typeof ColumnSchema> {}
export declare interface List extends z.infer<typeof ListSchema> {}
export declare interface Button extends z.infer<typeof ButtonSchema> {}
export declare interface Modal extends z.infer<typeof ModalSchema> {}
export declare interface Card extends z.infer<typeof CardSchema> {}
export declare interface Divider extends z.infer<typeof DividerSchema> {}
export declare interface TextField extends z.infer<typeof TextFieldSchema> {}
export declare interface Checkbox extends z.infer<typeof CheckboxSchema> {}
export declare interface DateTimeInput extends z.infer<typeof DateTimeInputSchema> {}
export declare interface MultipleChoice extends z.infer<typeof MultipleChoiceSchema> {}
export declare interface Slider extends z.infer<typeof SliderSchema> {}
