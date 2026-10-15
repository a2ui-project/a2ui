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
 * Per-component unions of the API definitions that the universal basic catalog
 * elements support. Each element takes its union as a type parameter, so its
 * props are inferred from every supported protocol version's schema.
 */

import type * as v0_9 from '../../../v0_9/basic_catalog/components/basic_components.js';
import type * as v1 from '../../../catalogs/basic/v1/components/basic_components.js';

export type AudioPlayerSupportedApis = typeof v0_9.AudioPlayerApi | typeof v1.AudioPlayerApi;
export type ButtonSupportedApis = typeof v0_9.ButtonApi | typeof v1.ButtonApi;
export type CardSupportedApis = typeof v0_9.CardApi | typeof v1.CardApi;
export type CheckBoxSupportedApis = typeof v0_9.CheckBoxApi | typeof v1.CheckBoxApi;
export type ChoicePickerSupportedApis = typeof v0_9.ChoicePickerApi | typeof v1.ChoicePickerApi;
export type ColumnSupportedApis = typeof v0_9.ColumnApi | typeof v1.ColumnApi;
export type DateTimeInputSupportedApis = typeof v0_9.DateTimeInputApi | typeof v1.DateTimeInputApi;
export type DividerSupportedApis = typeof v0_9.DividerApi | typeof v1.DividerApi;
export type IconSupportedApis = typeof v0_9.IconApi | typeof v1.IconApi;
export type ImageSupportedApis = typeof v0_9.ImageApi | typeof v1.ImageApi;
export type ListSupportedApis = typeof v0_9.ListApi | typeof v1.ListApi;
export type ModalSupportedApis = typeof v0_9.ModalApi | typeof v1.ModalApi;
export type RowSupportedApis = typeof v0_9.RowApi | typeof v1.RowApi;
export type SliderSupportedApis = typeof v0_9.SliderApi | typeof v1.SliderApi;
export type TabsSupportedApis = typeof v0_9.TabsApi | typeof v1.TabsApi;
export type TextSupportedApis = typeof v0_9.TextApi | typeof v1.TextApi;
export type TextFieldSupportedApis = typeof v0_9.TextFieldApi | typeof v1.TextFieldApi;
export type VideoSupportedApis = typeof v0_9.VideoApi | typeof v1.VideoApi;
