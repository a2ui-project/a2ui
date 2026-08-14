/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Catalog} from '@a2ui/web_core/v0_9';
import {
  basicCatalog as webCoreBasicCatalog,
  BASIC_FUNCTIONS,
} from '@a2ui/web_core/v0_9/basic_catalog';
import type {ReactComponentImplementation, ReactCatalogComponent} from '../../adapter';

import {Text} from './components/Text';
import {Image} from './components/Image';
import {Icon} from './components/Icon';
import {Video} from './components/Video';
import {AudioPlayer} from './components/AudioPlayer';
import {Row} from './components/Row';
import {Column} from './components/Column';
import {List} from './components/List';
import {Card} from './components/Card';
import {Tabs} from './components/Tabs';
import {Divider} from './components/Divider';
import {Modal} from './components/Modal';
import {Button} from './components/Button';
import {TextField} from './components/TextField';
import {CheckBox} from './components/CheckBox';
import {ChoicePicker} from './components/ChoicePicker';
import {Slider} from './components/Slider';
import {DateTimeInput} from './components/DateTimeInput';

export * from './context/MarkdownContext';

const basicComponents: ReactCatalogComponent[] = [
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
].map((impl: ReactComponentImplementation) => {
  const universal = webCoreBasicCatalog.components.get(impl.name);
  return {
    ...impl,
    tagName: impl.tagName || universal?.tagName,
  };
});

export const basicCatalog = new Catalog<ReactCatalogComponent>(
  webCoreBasicCatalog.id,
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
