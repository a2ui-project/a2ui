/**
 * Copyright 2026 kokoro-ele
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Catalog} from '@a2ui/web_core/v0_9';
import {BASIC_FUNCTIONS} from '@a2ui/web_core/v0_9/basic_catalog';
import type {InkComponentImplementation} from '../../adapter.js';

import {Text} from './components/Text.js';
import {Image} from './components/Image.js';
import {Icon} from './components/Icon.js';
import {Video} from './components/Video.js';
import {AudioPlayer} from './components/AudioPlayer.js';
import {Row} from './components/Row.js';
import {Column} from './components/Column.js';
import {List} from './components/List.js';
import {Card} from './components/Card.js';
import {Tabs} from './components/Tabs.js';
import {Divider} from './components/Divider.js';
import {Modal} from './components/Modal.js';
import {Button} from './components/Button.js';
import {TextField} from './components/TextField.js';
import {CheckBox} from './components/CheckBox.js';
import {ChoicePicker} from './components/ChoicePicker.js';
import {Slider} from './components/Slider.js';
import {DateTimeInput} from './components/DateTimeInput.js';

const basicComponents: InkComponentImplementation[] = [
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
];

/** Full basic catalog mapped to Ink terminal widgets. */
export const basicCatalog = new Catalog<InkComponentImplementation>(
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  basicComponents,
  BASIC_FUNCTIONS,
);

export {
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
};
