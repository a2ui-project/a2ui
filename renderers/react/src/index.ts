/*
 * Copyright 2026 Google LLC
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

/**
 * Public API surface for A2UI React Renderer.
 *
 * @module @a2ui/react
 */

export {A2uiSurface} from './A2uiSurface';
export {
  type ReactComponentImplementation,
  type ReactA2uiComponentProps,
  createComponentImplementation,
  createBinderlessComponentImplementation,
} from './adapter';

// Basic catalog & markdown context
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
