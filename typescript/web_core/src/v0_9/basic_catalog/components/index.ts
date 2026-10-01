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

import {toWebComponentImplementation} from '../../../universal/index.js';
import {
  A2uiAudioPlayerElement,
  A2uiBasicButtonElement,
  A2uiBasicColumnElement,
  A2uiBasicRowElement,
  A2uiBasicTextElement,
  A2uiBasicTextFieldElement,
  A2uiCardElement,
  A2uiCheckBoxElement,
  A2uiChoicePickerElement,
  A2uiDateTimeInputElement,
  A2uiDividerElement,
  A2uiIconElement,
  A2uiImageElement,
  A2uiListElement,
  A2uiModalElement,
  A2uiSliderElement,
  A2uiTabsElement,
  A2uiVideoElement,
} from '../../../universal/basic_catalog/components/index.js';
import {
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

export const A2uiAudioPlayer = toWebComponentImplementation(A2uiAudioPlayerElement, AudioPlayerApi);
export const A2uiButton = toWebComponentImplementation(A2uiBasicButtonElement, ButtonApi);
export const A2uiCard = toWebComponentImplementation(A2uiCardElement, CardApi);
export const A2uiCheckBox = toWebComponentImplementation(A2uiCheckBoxElement, CheckBoxApi);
export const A2uiChoicePicker = toWebComponentImplementation(
  A2uiChoicePickerElement,
  ChoicePickerApi,
);
export const A2uiColumn = toWebComponentImplementation(A2uiBasicColumnElement, ColumnApi);
export const A2uiDateTimeInput = toWebComponentImplementation(
  A2uiDateTimeInputElement,
  DateTimeInputApi,
);
export const A2uiDivider = toWebComponentImplementation(A2uiDividerElement, DividerApi);
export const A2uiIcon = toWebComponentImplementation(A2uiIconElement, IconApi);
export const A2uiImage = toWebComponentImplementation(A2uiImageElement, ImageApi);
export const A2uiList = toWebComponentImplementation(A2uiListElement, ListApi);
export const A2uiModal = toWebComponentImplementation(A2uiModalElement, ModalApi);
export const A2uiRow = toWebComponentImplementation(A2uiBasicRowElement, RowApi);
export const A2uiSlider = toWebComponentImplementation(A2uiSliderElement, SliderApi);
export const A2uiTabs = toWebComponentImplementation(A2uiTabsElement, TabsApi);
export const A2uiText = toWebComponentImplementation(A2uiBasicTextElement, TextApi);
export const A2uiTextField = toWebComponentImplementation(A2uiBasicTextFieldElement, TextFieldApi);
export const A2uiVideo = toWebComponentImplementation(A2uiVideoElement, VideoApi);

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
