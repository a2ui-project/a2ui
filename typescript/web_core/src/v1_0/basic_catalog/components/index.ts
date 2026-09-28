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

import * as universal from '../../../universal/basic_catalog/components/index.js';
import * as v1_0Apis from './basic_components.js';
import type {WebComponentImplementation} from '../../../universal/index.js';

export const A2uiAudioPlayer: WebComponentImplementation<typeof v1_0Apis.AudioPlayerApi.schema> = {
  ...v1_0Apis.AudioPlayerApi,
  tagName: universal.AUDIO_PLAYER_TAG_NAME,
  element: universal.A2uiAudioPlayerElement,
};
export const A2uiButton: WebComponentImplementation<typeof v1_0Apis.ButtonApi.schema> = {
  ...v1_0Apis.ButtonApi,
  tagName: universal.BUTTON_TAG_NAME,
  element: universal.A2uiBasicButtonElement,
};
export const A2uiCard: WebComponentImplementation<typeof v1_0Apis.CardApi.schema> = {
  ...v1_0Apis.CardApi,
  tagName: universal.CARD_TAG_NAME,
  element: universal.A2uiCardElement,
};
export const A2uiCheckBox: WebComponentImplementation<typeof v1_0Apis.CheckBoxApi.schema> = {
  ...v1_0Apis.CheckBoxApi,
  tagName: universal.CHECK_BOX_TAG_NAME,
  element: universal.A2uiCheckBoxElement,
};
export const A2uiChoicePicker: WebComponentImplementation<typeof v1_0Apis.ChoicePickerApi.schema> =
  {
    ...v1_0Apis.ChoicePickerApi,
    tagName: universal.CHOICE_PICKER_TAG_NAME,
    element: universal.A2uiChoicePickerElement,
  };
export const A2uiColumn: WebComponentImplementation<typeof v1_0Apis.ColumnApi.schema> = {
  ...v1_0Apis.ColumnApi,
  tagName: universal.COLUMN_TAG_NAME,
  element: universal.A2uiBasicColumnElement,
};
export const A2uiDateTimeInput: WebComponentImplementation<
  typeof v1_0Apis.DateTimeInputApi.schema
> = {
  ...v1_0Apis.DateTimeInputApi,
  tagName: universal.DATE_TIME_INPUT_TAG_NAME,
  element: universal.A2uiDateTimeInputElement,
};
export const A2uiDivider: WebComponentImplementation<typeof v1_0Apis.DividerApi.schema> = {
  ...v1_0Apis.DividerApi,
  tagName: universal.DIVIDER_TAG_NAME,
  element: universal.A2uiDividerElement,
};
export const A2uiIcon: WebComponentImplementation<typeof v1_0Apis.IconApi.schema> = {
  ...v1_0Apis.IconApi,
  tagName: universal.ICON_TAG_NAME,
  element: universal.A2uiIconElement,
};
export const A2uiImage: WebComponentImplementation<typeof v1_0Apis.ImageApi.schema> = {
  ...v1_0Apis.ImageApi,
  tagName: universal.IMAGE_TAG_NAME,
  element: universal.A2uiImageElement,
};
export const A2uiList: WebComponentImplementation<typeof v1_0Apis.ListApi.schema> = {
  ...v1_0Apis.ListApi,
  tagName: universal.LIST_TAG_NAME,
  element: universal.A2uiListElement,
};
export const A2uiModal: WebComponentImplementation<typeof v1_0Apis.ModalApi.schema> = {
  ...v1_0Apis.ModalApi,
  tagName: universal.MODAL_TAG_NAME,
  element: universal.A2uiLitModal,
};
export const A2uiRow: WebComponentImplementation<typeof v1_0Apis.RowApi.schema> = {
  ...v1_0Apis.RowApi,
  tagName: universal.ROW_TAG_NAME,
  element: universal.A2uiBasicRowElement,
};
export const A2uiSlider: WebComponentImplementation<typeof v1_0Apis.SliderApi.schema> = {
  ...v1_0Apis.SliderApi,
  tagName: universal.SLIDER_TAG_NAME,
  element: universal.A2uiSliderElement,
};
export const A2uiTabs: WebComponentImplementation<typeof v1_0Apis.TabsApi.schema> = {
  ...v1_0Apis.TabsApi,
  tagName: universal.TABS_TAG_NAME,
  element: universal.A2uiLitTabs,
};
export const A2uiText: WebComponentImplementation<typeof v1_0Apis.TextApi.schema> = {
  ...v1_0Apis.TextApi,
  tagName: universal.TEXT_TAG_NAME,
  element: universal.A2uiBasicTextElement,
};
export const A2uiTextField: WebComponentImplementation<typeof v1_0Apis.TextFieldApi.schema> = {
  ...v1_0Apis.TextFieldApi,
  tagName: universal.TEXT_FIELD_TAG_NAME,
  element: universal.A2uiBasicTextFieldElement,
};
export const A2uiVideo: WebComponentImplementation<typeof v1_0Apis.VideoApi.schema> = {
  ...v1_0Apis.VideoApi,
  tagName: universal.VIDEO_TAG_NAME,
  element: universal.A2uiVideoElement,
};

export * from '../../../universal/basic_catalog/components/index.js';
export * from './basic_components.js';
