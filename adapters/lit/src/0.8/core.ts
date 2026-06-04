/*
 * Copyright 2025 Google LLC
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

export * as Events from './events/events.js';
import * as Types from '@a2ui/web_core/types/types';
import * as Guards from '@a2ui/web_core/data/guards';
import {Schemas} from '@a2ui/web_core';
import * as Styles from '@a2ui/web_core/styles/index';
import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';
import * as Primitives from '@a2ui/web_core/types/primitives';
import {create as createSignalA2uiMessageProcessor} from './data/signal-model-processor.js';
import {Events as WebEvents} from '@a2ui/web_core';
export {Types, Guards, Schemas, Styles, A2uiMessageProcessor, Primitives, WebEvents};

export const Data = {
  createSignalA2uiMessageProcessor,
  A2uiMessageProcessor,
  Guards,
};
