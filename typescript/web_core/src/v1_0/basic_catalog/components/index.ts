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

import * as universalComponents from '../../../universal/basic_catalog/components/index.js';
import * as v1_0Apis from './basic_components.js';
import type {WebComponentImplementation} from '../../../universal/index.js';

export const A2uiAudioPlayer: WebComponentImplementation = {
  ...universalComponents.A2uiAudioPlayer,
  ...v1_0Apis.AudioPlayerApi,
};
export const A2uiButton: WebComponentImplementation = {
  ...universalComponents.A2uiButton,
  ...v1_0Apis.ButtonApi,
};
export const A2uiCard: WebComponentImplementation = {
  ...universalComponents.A2uiCard,
  ...v1_0Apis.CardApi,
};
export const A2uiCheckBox: WebComponentImplementation = {
  ...universalComponents.A2uiCheckBox,
  ...v1_0Apis.CheckBoxApi,
};
export const A2uiChoicePicker: WebComponentImplementation = {
  ...universalComponents.A2uiChoicePicker,
  ...v1_0Apis.ChoicePickerApi,
};
export const A2uiColumn: WebComponentImplementation = {
  ...universalComponents.A2uiColumn,
  ...v1_0Apis.ColumnApi,
};
export const A2uiDateTimeInput: WebComponentImplementation = {
  ...universalComponents.A2uiDateTimeInput,
  ...v1_0Apis.DateTimeInputApi,
};
export const A2uiDivider: WebComponentImplementation = {
  ...universalComponents.A2uiDivider,
  ...v1_0Apis.DividerApi,
};
export const A2uiIcon: WebComponentImplementation = {
  ...universalComponents.A2uiIcon,
  ...v1_0Apis.IconApi,
};
export const A2uiImage: WebComponentImplementation = {
  ...universalComponents.A2uiImage,
  ...v1_0Apis.ImageApi,
};
export const A2uiList: WebComponentImplementation = {
  ...universalComponents.A2uiList,
  ...v1_0Apis.ListApi,
};
export const A2uiModal: WebComponentImplementation = {
  ...universalComponents.A2uiModal,
  ...v1_0Apis.ModalApi,
};
export const A2uiRow: WebComponentImplementation = {
  ...universalComponents.A2uiRow,
  ...v1_0Apis.RowApi,
};
export const A2uiSlider: WebComponentImplementation = {
  ...universalComponents.A2uiSlider,
  ...v1_0Apis.SliderApi,
};
export const A2uiTabs: WebComponentImplementation = {
  ...universalComponents.A2uiTabs,
  ...v1_0Apis.TabsApi,
};
export const A2uiText: WebComponentImplementation = {
  ...universalComponents.A2uiText,
  ...v1_0Apis.TextApi,
};
export const A2uiTextField: WebComponentImplementation = {
  ...universalComponents.A2uiTextField,
  ...v1_0Apis.TextFieldApi,
};
export const A2uiVideo: WebComponentImplementation = {
  ...universalComponents.A2uiVideo,
  ...v1_0Apis.VideoApi,
};

export * from '../../../universal/basic_catalog/components/index.js';
export * from './basic_components.js';
