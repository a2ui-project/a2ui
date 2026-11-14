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

/**
 * Per-component unions of the component APIs that the universal basic catalog
 * elements support: the API of the component in each protocol version's
 * basic catalog document, typed with that document's generated props type.
 * A surface picks the document of its own version through its catalog, and
 * each element takes its union as a type parameter, so its props are typed
 * as every supported version's document declares them.
 */

import type {ComponentApi} from '../../../catalog/types.js';
import type {CatalogSchema} from '../../../schema-engine/types.js';
import type * as v0_9 from '../../../v0_9/basic_catalog/generated-types.js';
import type * as v1 from '../../../catalogs/basic/v1/generated-types.js';

/** A component API whose props are `Props`. */
type ApiOf<Props> = ComponentApi<CatalogSchema<Props>>;

export type AudioPlayerSupportedApis = ApiOf<v0_9.AudioPlayerProps> | ApiOf<v1.AudioPlayerProps>;
export type ButtonSupportedApis = ApiOf<v0_9.ButtonProps> | ApiOf<v1.ButtonProps>;
export type CardSupportedApis = ApiOf<v0_9.CardProps> | ApiOf<v1.CardProps>;
export type CheckBoxSupportedApis = ApiOf<v0_9.CheckBoxProps> | ApiOf<v1.CheckBoxProps>;
export type ChoicePickerSupportedApis = ApiOf<v0_9.ChoicePickerProps> | ApiOf<v1.ChoicePickerProps>;
export type ColumnSupportedApis = ApiOf<v0_9.ColumnProps> | ApiOf<v1.ColumnProps>;
export type DateTimeInputSupportedApis =
  | ApiOf<v0_9.DateTimeInputProps>
  | ApiOf<v1.DateTimeInputProps>;
export type DividerSupportedApis = ApiOf<v0_9.DividerProps> | ApiOf<v1.DividerProps>;
export type IconSupportedApis = ApiOf<v0_9.IconProps> | ApiOf<v1.IconProps>;
export type ImageSupportedApis = ApiOf<v0_9.ImageProps> | ApiOf<v1.ImageProps>;
export type ListSupportedApis = ApiOf<v0_9.ListProps> | ApiOf<v1.ListProps>;
export type ModalSupportedApis = ApiOf<v0_9.ModalProps> | ApiOf<v1.ModalProps>;
export type RowSupportedApis = ApiOf<v0_9.RowProps> | ApiOf<v1.RowProps>;
export type SliderSupportedApis = ApiOf<v0_9.SliderProps> | ApiOf<v1.SliderProps>;
export type TabsSupportedApis = ApiOf<v0_9.TabsProps> | ApiOf<v1.TabsProps>;
export type TextSupportedApis = ApiOf<v0_9.TextProps> | ApiOf<v1.TextProps>;
export type TextFieldSupportedApis = ApiOf<v0_9.TextFieldProps> | ApiOf<v1.TextFieldProps>;
export type VideoSupportedApis = ApiOf<v0_9.VideoProps> | ApiOf<v1.VideoProps>;
