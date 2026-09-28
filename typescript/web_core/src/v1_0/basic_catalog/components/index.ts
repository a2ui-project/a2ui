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

import type {WebComponentImplementation} from '../../../v0_9/universal/index.js';
import {
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
import {A2uiAudioPlayer as V09AudioPlayer} from '../../../v0_9/basic_catalog/components/AudioPlayer.js';
import {A2uiButton as V09Button} from '../../../v0_9/basic_catalog/components/Button.js';
import {A2uiCard as V09Card} from '../../../v0_9/basic_catalog/components/Card.js';
import {A2uiCheckBox as V09CheckBox} from '../../../v0_9/basic_catalog/components/CheckBox.js';
import {A2uiChoicePicker as V09ChoicePicker} from '../../../v0_9/basic_catalog/components/ChoicePicker.js';
import {A2uiColumn as V09Column} from '../../../v0_9/basic_catalog/components/Column.js';
import {A2uiDateTimeInput as V09DateTimeInput} from '../../../v0_9/basic_catalog/components/DateTimeInput.js';
import {A2uiDivider as V09Divider} from '../../../v0_9/basic_catalog/components/Divider.js';
import {A2uiIcon as V09Icon} from '../../../v0_9/basic_catalog/components/Icon.js';
import {A2uiImage as V09Image} from '../../../v0_9/basic_catalog/components/Image.js';
import {A2uiList as V09List} from '../../../v0_9/basic_catalog/components/List.js';
import {A2uiModal as V09Modal} from '../../../v0_9/basic_catalog/components/Modal.js';
import {A2uiRow as V09Row} from '../../../v0_9/basic_catalog/components/Row.js';
import {A2uiSlider as V09Slider} from '../../../v0_9/basic_catalog/components/Slider.js';
import {A2uiTabs as V09Tabs} from '../../../v0_9/basic_catalog/components/Tabs.js';
import {A2uiText as V09Text} from '../../../v0_9/basic_catalog/components/Text.js';
import {A2uiTextField as V09TextField} from '../../../v0_9/basic_catalog/components/TextField.js';
import {A2uiVideo as V09Video} from '../../../v0_9/basic_catalog/components/Video.js';

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
};

export const A2uiAudioPlayer: WebComponentImplementation = {
  ...AudioPlayerApi,
  tagName: V09AudioPlayer.tagName,
  element: V09AudioPlayer.element,
};

export const A2uiButton: WebComponentImplementation = {
  ...ButtonApi,
  tagName: V09Button.tagName,
  element: V09Button.element,
};

export const A2uiCard: WebComponentImplementation = {
  ...CardApi,
  tagName: V09Card.tagName,
  element: V09Card.element,
};

export const A2uiCheckBox: WebComponentImplementation = {
  ...CheckBoxApi,
  tagName: V09CheckBox.tagName,
  element: V09CheckBox.element,
};

export const A2uiChoicePicker: WebComponentImplementation = {
  ...ChoicePickerApi,
  tagName: V09ChoicePicker.tagName,
  element: V09ChoicePicker.element,
};

export const A2uiColumn: WebComponentImplementation = {
  ...ColumnApi,
  tagName: V09Column.tagName,
  element: V09Column.element,
};

export const A2uiDateTimeInput: WebComponentImplementation = {
  ...DateTimeInputApi,
  tagName: V09DateTimeInput.tagName,
  element: V09DateTimeInput.element,
};

export const A2uiDivider: WebComponentImplementation = {
  ...DividerApi,
  tagName: V09Divider.tagName,
  element: V09Divider.element,
};

export const A2uiIcon: WebComponentImplementation = {
  ...IconApi,
  tagName: V09Icon.tagName,
  element: V09Icon.element,
};

export const A2uiImage: WebComponentImplementation = {
  ...ImageApi,
  tagName: V09Image.tagName,
  element: V09Image.element,
};

export const A2uiList: WebComponentImplementation = {
  ...ListApi,
  tagName: V09List.tagName,
  element: V09List.element,
};

export const A2uiModal: WebComponentImplementation = {
  ...ModalApi,
  tagName: V09Modal.tagName,
  element: V09Modal.element,
};

export const A2uiRow: WebComponentImplementation = {
  ...RowApi,
  tagName: V09Row.tagName,
  element: V09Row.element,
};

export const A2uiSlider: WebComponentImplementation = {
  ...SliderApi,
  tagName: V09Slider.tagName,
  element: V09Slider.element,
};

export const A2uiTabs: WebComponentImplementation = {
  ...TabsApi,
  tagName: V09Tabs.tagName,
  element: V09Tabs.element,
};

export const A2uiText: WebComponentImplementation = {
  ...TextApi,
  tagName: V09Text.tagName,
  element: V09Text.element,
};

export const A2uiTextField: WebComponentImplementation = {
  ...TextFieldApi,
  tagName: V09TextField.tagName,
  element: V09TextField.element,
};

export const A2uiVideo: WebComponentImplementation = {
  ...VideoApi,
  tagName: V09Video.tagName,
  element: V09Video.element,
};
