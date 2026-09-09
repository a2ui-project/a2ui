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

export {A2uiSurface} from './A2uiSurface';
export {
  createComponentImplementation,
  createBinderlessComponentImplementation,
  type ReactComponentImplementation,
  type ReactA2uiComponentProps,
} from './adapter';
export {useSignalValue, type NodeBuildChild, type NodeViewProps} from './node-view';

// Export basic catalog components directly for 3P developers
export {
  MarkdownContext,
  useMarkdownRenderer,
  basicCatalog,
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
} from './catalog/basic';
