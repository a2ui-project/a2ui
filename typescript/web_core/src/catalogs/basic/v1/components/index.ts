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

import {toWebComponentImplementation} from '../../../../universal/to_web_component_implementation.js';
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
} from '../../../../universal/basic_catalog/components/index.js';
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

/*
 * The basic catalog elements bound to the v1 API. The tag names carry a `-v1`
 * suffix so they can be registered next to the v0.9 elements. The shared
 * element classes live in `universal/basic_catalog/components`.
 */

export const A2uiAudioPlayer = toWebComponentImplementation(
  A2uiAudioPlayerElement,
  AudioPlayerApi,
  'a2ui-audioplayer-v1',
);

export const A2uiButton = toWebComponentImplementation(
  A2uiBasicButtonElement,
  ButtonApi,
  'a2ui-basic-button-v1',
);

export const A2uiCard = toWebComponentImplementation(A2uiCardElement, CardApi, 'a2ui-card-v1');

export const A2uiCheckBox = toWebComponentImplementation(
  A2uiCheckBoxElement,
  CheckBoxApi,
  'a2ui-checkbox-v1',
);

export const A2uiChoicePicker = toWebComponentImplementation(
  A2uiChoicePickerElement,
  ChoicePickerApi,
  'a2ui-choicepicker-v1',
);

export const A2uiColumn = toWebComponentImplementation(
  A2uiBasicColumnElement,
  ColumnApi,
  'a2ui-basic-column-v1',
);

export const A2uiDateTimeInput = toWebComponentImplementation(
  A2uiDateTimeInputElement,
  DateTimeInputApi,
  'a2ui-datetimeinput-v1',
);

export const A2uiDivider = toWebComponentImplementation(
  A2uiDividerElement,
  DividerApi,
  'a2ui-divider-v1',
);

export const A2uiIcon = toWebComponentImplementation(A2uiIconElement, IconApi, 'a2ui-icon-v1');

export const A2uiImage = toWebComponentImplementation(A2uiImageElement, ImageApi, 'a2ui-image-v1');

export const A2uiList = toWebComponentImplementation(A2uiListElement, ListApi, 'a2ui-list-v1');

export const A2uiModal = toWebComponentImplementation(A2uiModalElement, ModalApi, 'a2ui-modal-v1');

export const A2uiRow = toWebComponentImplementation(
  A2uiBasicRowElement,
  RowApi,
  'a2ui-basic-row-v1',
);

export const A2uiSlider = toWebComponentImplementation(
  A2uiSliderElement,
  SliderApi,
  'a2ui-slider-v1',
);

export const A2uiTabs = toWebComponentImplementation(A2uiTabsElement, TabsApi, 'a2ui-tabs-v1');

export const A2uiText = toWebComponentImplementation(
  A2uiBasicTextElement,
  TextApi,
  'a2ui-basic-text-v1',
);

export const A2uiTextField = toWebComponentImplementation(
  A2uiBasicTextFieldElement,
  TextFieldApi,
  'a2ui-basic-textfield-v1',
);

export const A2uiVideo = toWebComponentImplementation(A2uiVideoElement, VideoApi, 'a2ui-video-v1');

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
