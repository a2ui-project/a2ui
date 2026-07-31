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
import type {StringValue} from './primitives.js';
import {
  ActionValueObjectSchema,
  ActionObjectSchema,
  TextSchema,
  ImageSchema,
  IconSchema,
  VideoSchema,
  AudioPlayerSchema,
  TabsSchema,
  DividerSchema,
  ModalSchema,
  ButtonSchema,
  TextFieldSchema,
  CheckboxObjectSchema,
  DateTimeInputSchema,
  MultipleChoiceObjectSchema,
  SliderObjectSchema,
  ComponentArrayTemplateSchema,
  ComponentArrayReferenceObjectSchema,
  RowSchema,
  ColumnSchema,
  ListSchema,
  CardSchema,
} from '../schema/common-types.js';

export interface ActionValue extends z.infer<typeof ActionValueObjectSchema> {
  [key: string]: any;
}

export interface Action extends z.infer<typeof ActionObjectSchema> {
  [key: string]: any;
}

/**
 * Text component properties.
 * Corresponds to `TextSchema` in `../schema/common-types.js`.
 */
export interface Text extends z.infer<typeof TextSchema> {
  [key: string]: any;
}

/**
 * Image component properties.
 * Corresponds to `ImageSchema` in `../schema/common-types.js`.
 */
export interface Image extends z.infer<typeof ImageSchema> {
  [key: string]: any;
}

/**
 * Icon component properties.
 * Corresponds to `IconSchema` in `../schema/common-types.js`.
 */
export interface Icon extends z.infer<typeof IconSchema> {
  [key: string]: any;
}

/**
 * Video component properties.
 * Corresponds to `VideoSchema` in `../schema/common-types.js`.
 */
export interface Video extends z.infer<typeof VideoSchema> {
  [key: string]: any;
}

/**
 * AudioPlayer component properties.
 * Corresponds to `AudioPlayerSchema` in `../schema/common-types.js`.
 */
export interface AudioPlayer extends z.infer<typeof AudioPlayerSchema> {
  [key: string]: any;
}

/**
 * Tab item definition for Tabs container.
 * Corresponds to `TabItemSchema` in `../schema/common-types.js`.
 */
export interface TabItem {
  title: StringValue;
  child: string;
  [key: string]: any;
}

/**
 * Tabs container component properties.
 * Corresponds to `TabsSchema` in `../schema/common-types.js`.
 */
export interface Tabs extends z.infer<typeof TabsSchema> {
  [key: string]: any;
}

/**
 * Template for dynamic component array rendering.
 * Corresponds to `ComponentArrayTemplateSchema` in `../schema/common-types.js`.
 */
export interface ComponentArrayTemplate extends z.infer<typeof ComponentArrayTemplateSchema> {
  [key: string]: any;
}

/**
 * Reference list or template for container children.
 * Corresponds to `ComponentArrayReferenceSchema` in `../schema/common-types.js`.
 */
export interface ComponentArrayReference extends z.infer<
  typeof ComponentArrayReferenceObjectSchema
> {
  [key: string]: any;
}

/**
 * Row layout container component properties.
 * Corresponds to `RowSchema` in `../schema/common-types.js`.
 */
export interface Row extends z.infer<typeof RowSchema> {
  [key: string]: any;
}

/**
 * Column layout container component properties.
 * Corresponds to `ColumnSchema` in `../schema/common-types.js`.
 */
export interface Column extends z.infer<typeof ColumnSchema> {
  [key: string]: any;
}

/**
 * List container component properties.
 * Corresponds to `ListSchema` in `../schema/common-types.js`.
 */
export interface List extends z.infer<typeof ListSchema> {
  [key: string]: any;
}

/**
 * Button component properties.
 * Corresponds to `ButtonSchema` in `../schema/common-types.js`.
 */
export interface Button extends z.infer<typeof ButtonSchema> {
  [key: string]: any;
}

/**
 * Modal dialog component properties.
 * Corresponds to `ModalSchema` in `../schema/common-types.js`.
 */
export interface Modal extends z.infer<typeof ModalSchema> {
  [key: string]: any;
}

/**
 * Card container component properties.
 * Corresponds to `CardSchema` in `../schema/common-types.js`.
 */
export interface Card extends z.infer<typeof CardSchema> {
  [key: string]: any;
}

/**
 * Divider line component properties.
 * Corresponds to `DividerSchema` in `../schema/common-types.js`.
 */
export interface Divider extends z.infer<typeof DividerSchema> {
  [key: string]: any;
}

/**
 * TextField input component properties.
 * Corresponds to `TextFieldSchema` in `../schema/common-types.js`.
 */
export interface TextField extends z.infer<typeof TextFieldSchema> {
  [key: string]: any;
}

/**
 * Checkbox input component properties.
 * Corresponds to `CheckboxSchema` in `../schema/common-types.js`.
 */
export interface Checkbox extends z.infer<typeof CheckboxObjectSchema> {
  [key: string]: any;
}

/**
 * DateTimeInput component properties.
 * Corresponds to `DateTimeInputSchema` in `../schema/common-types.js`.
 */
export interface DateTimeInput extends z.infer<typeof DateTimeInputSchema> {
  [key: string]: any;
}

/**
 * MultipleChoice input component properties.
 * Corresponds to `MultipleChoiceSchema` in `../schema/common-types.js`.
 */
export interface MultipleChoice extends z.infer<typeof MultipleChoiceObjectSchema> {
  [key: string]: any;
}

/**
 * Slider input component properties.
 * Corresponds to `SliderSchema` in `../schema/common-types.js`.
 */
export interface Slider extends z.infer<typeof SliderObjectSchema> {
  [key: string]: any;
}
