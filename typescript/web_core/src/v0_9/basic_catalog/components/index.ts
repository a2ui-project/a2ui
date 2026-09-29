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
import * as v0_9Apis from './basic_components.js';
import type {WebComponentImplementation} from '../../../universal/index.js';

export const A2uiAudioPlayer: WebComponentImplementation<typeof v0_9Apis.AudioPlayerApi.schema> = {
  ...v0_9Apis.AudioPlayerApi,
  tagName: universal.AUDIO_PLAYER_TAG_NAME,
  element: universal.A2uiAudioPlayerElement,
};
export const A2uiButton: WebComponentImplementation<typeof v0_9Apis.ButtonApi.schema> = {
  ...v0_9Apis.ButtonApi,
  tagName: universal.BUTTON_TAG_NAME,
  element: universal.A2uiBasicButtonElement,
};
export const A2uiCard: WebComponentImplementation<typeof v0_9Apis.CardApi.schema> = {
  ...v0_9Apis.CardApi,
  tagName: universal.CARD_TAG_NAME,
  element: universal.A2uiCardElement,
};
export const A2uiCheckBox: WebComponentImplementation<typeof v0_9Apis.CheckBoxApi.schema> = {
  ...v0_9Apis.CheckBoxApi,
  tagName: universal.CHECK_BOX_TAG_NAME,
  element: universal.A2uiCheckBoxElement,
};
export const A2uiChoicePicker: WebComponentImplementation<typeof v0_9Apis.ChoicePickerApi.schema> =
  {
    ...v0_9Apis.ChoicePickerApi,
    tagName: universal.CHOICE_PICKER_TAG_NAME,
    element: universal.A2uiChoicePickerElement,
  };
export const A2uiColumn: WebComponentImplementation<typeof v0_9Apis.ColumnApi.schema> = {
  ...v0_9Apis.ColumnApi,
  tagName: universal.COLUMN_TAG_NAME,
  element: universal.A2uiBasicColumnElement,
};
export const A2uiDateTimeInput: WebComponentImplementation<
  typeof v0_9Apis.DateTimeInputApi.schema
> = {
  ...v0_9Apis.DateTimeInputApi,
  tagName: universal.DATE_TIME_INPUT_TAG_NAME,
  element: universal.A2uiDateTimeInputElement,
};
export const A2uiDivider: WebComponentImplementation<typeof v0_9Apis.DividerApi.schema> = {
  ...v0_9Apis.DividerApi,
  tagName: universal.DIVIDER_TAG_NAME,
  element: universal.A2uiDividerElement,
};
export const A2uiIcon: WebComponentImplementation<typeof v0_9Apis.IconApi.schema> = {
  ...v0_9Apis.IconApi,
  tagName: universal.ICON_TAG_NAME,
  element: universal.A2uiIconElement,
};
export const A2uiImage: WebComponentImplementation<typeof v0_9Apis.ImageApi.schema> = {
  ...v0_9Apis.ImageApi,
  tagName: universal.IMAGE_TAG_NAME,
  element: universal.A2uiImageElement,
};
export const A2uiList: WebComponentImplementation<typeof v0_9Apis.ListApi.schema> = {
  ...v0_9Apis.ListApi,
  tagName: universal.LIST_TAG_NAME,
  element: universal.A2uiListElement,
};
export const A2uiModal: WebComponentImplementation<typeof v0_9Apis.ModalApi.schema> = {
  ...v0_9Apis.ModalApi,
  tagName: universal.MODAL_TAG_NAME,
  element: universal.A2uiLitModal,
};
export const A2uiRow: WebComponentImplementation<typeof v0_9Apis.RowApi.schema> = {
  ...v0_9Apis.RowApi,
  tagName: universal.ROW_TAG_NAME,
  element: universal.A2uiBasicRowElement,
};
export const A2uiSlider: WebComponentImplementation<typeof v0_9Apis.SliderApi.schema> = {
  ...v0_9Apis.SliderApi,
  tagName: universal.SLIDER_TAG_NAME,
  element: universal.A2uiSliderElement,
};
export const A2uiTabs: WebComponentImplementation<typeof v0_9Apis.TabsApi.schema> = {
  ...v0_9Apis.TabsApi,
  tagName: universal.TABS_TAG_NAME,
  element: universal.A2uiLitTabs,
};
export const A2uiText: WebComponentImplementation<typeof v0_9Apis.TextApi.schema> = {
  ...v0_9Apis.TextApi,
  tagName: universal.TEXT_TAG_NAME,
  element: universal.A2uiBasicTextElement,
};
export const A2uiTextField: WebComponentImplementation<typeof v0_9Apis.TextFieldApi.schema> = {
  ...v0_9Apis.TextFieldApi,
  tagName: universal.TEXT_FIELD_TAG_NAME,
  element: universal.A2uiBasicTextFieldElement,
};
export const A2uiVideo: WebComponentImplementation<typeof v0_9Apis.VideoApi.schema> = {
  ...v0_9Apis.VideoApi,
  tagName: universal.VIDEO_TAG_NAME,
  element: universal.A2uiVideoElement,
};

export {
  BASIC_COMPONENTS,
  AudioPlayerApi,
  ButtonApi,
  CardApi,
  CheckBoxApi,
  ChoicePickerApi,
  ColumnApi,
  DateTimeInputApi,
  DividerApi,
  IconApi,
  ImageApi,
  ListApi,
  ModalApi,
  RowApi,
  SliderApi,
  TabsApi,
  TextApi,
  TextFieldApi,
  VideoApi,
} from './basic_components.js';
