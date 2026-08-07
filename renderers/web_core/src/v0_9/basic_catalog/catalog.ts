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

import {Catalog, WebComponentImplementation} from '../catalog/types.js';
import {BASIC_FUNCTIONS} from './functions/basic_functions.js';

import {A2uiText} from './components/Text.js';
import {A2uiButton} from './components/Button.js';
import {A2uiTextField} from './components/TextField.js';
import {A2uiRow} from './components/Row.js';
import {A2uiColumn} from './components/Column.js';
import {A2uiList} from './components/List.js';
import {A2uiImage} from './components/Image.js';
import {A2uiIcon} from './components/Icon.js';
import {A2uiVideo} from './components/Video.js';
import {A2uiAudioPlayer} from './components/AudioPlayer.js';
import {A2uiCard} from './components/Card.js';
import {A2uiDivider} from './components/Divider.js';
import {A2uiCheckBox} from './components/CheckBox.js';
import {A2uiSlider} from './components/Slider.js';
import {A2uiDateTimeInput} from './components/DateTimeInput.js';
import {A2uiChoicePicker} from './components/ChoicePicker.js';
import {A2uiTabs} from './components/Tabs.js';
import {A2uiModal} from './components/Modal.js';

/**
 * The single canonical basic catalog of A2UI components implemented via Web Components (Custom Elements).
 */
export const basicCatalog = new Catalog<WebComponentImplementation>(
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  [
    A2uiText,
    A2uiButton,
    A2uiTextField,
    A2uiRow,
    A2uiColumn,
    A2uiList,
    A2uiImage,
    A2uiIcon,
    A2uiVideo,
    A2uiAudioPlayer,
    A2uiCard,
    A2uiDivider,
    A2uiCheckBox,
    A2uiSlider,
    A2uiDateTimeInput,
    A2uiChoicePicker,
    A2uiTabs,
    A2uiModal,
  ],
  BASIC_FUNCTIONS,
);
