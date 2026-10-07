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

import {AgentToRendererMessage} from '../internal/web_core.js';

/**
 * A text segment from the model's response.
 */
export interface TextPart {
  type: 'text';
  text: string;
}

/**
 * An uncompiled format-specific block (e.g., raw JSON string).
 */
export interface RawA2uiPart {
  type: 'a2ui';
  a2uiRaw: string;
}

/**
 * A response part before format-specific compilation.
 * Uses an intersection type to ergonomically attach the stream truncation state
 * without adding wrapping indirection that would break discriminated union narrowing.
 */
export type RawResponsePart = (TextPart | RawA2uiPart) & {isFinal: boolean};

/**
 * A compiled A2UI payload block.
 */
export interface A2uiPart {
  type: 'a2ui';
  a2ui: AgentToRendererMessage[];
}

/**
 * A structured part of a model's response.
 */
export type ResponsePart = TextPart | A2uiPart;
