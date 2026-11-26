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

/**
 * The v1.0 wire values that macro parameters hand to `render`, after the expander has
 * turned the shorthands a model writes into their full form.
 */

import {ComponentChild} from '../component-tree/component-node.js';

/** A binding to a value in the data model. */
export interface DataBinding {
  '@path': string;
}

/** A call to a function of the catalog. */
export interface FunctionCall {
  '@call': string;
  args?: Record<string, unknown>;
  returnType?: string;
}

export type DynamicString = string | DataBinding | FunctionCall;
export type DynamicNumber = number | DataBinding | FunctionCall;
export type DynamicBoolean = boolean | DataBinding | FunctionCall;
export type DynamicStringList = string[] | DataBinding | FunctionCall;

/** A literal of any JSON type, a data binding or a function call. */
export type DynamicValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>
  | DataBinding
  | FunctionCall;

/** An event sent to the agent. */
export interface ActionEvent {
  name: string;
  context?: Record<string, unknown>;
  userMessage?: DynamicString;
}

/** Sends an event to the agent or calls a function on the renderer. */
export type Action = {event: ActionEvent} | {functionCall: FunctionCall};

/** A rule an input component checks on the renderer. */
export interface CheckRule {
  condition: DataBinding | FunctionCall;
  message?: string;
}

export interface AccessibilityAttributes {
  label?: DynamicString;
  description?: DynamicString;
  live?: 'off' | 'polite' | 'assertive';
  hidden?: DynamicBoolean;
}

/** Children generated from a data model list, one per item, from a template component. */
export interface DynamicChildList {
  path: string;
  componentId: ComponentChild;
}

/** A static list of children, or children generated from a data model list. */
export type ChildList = ComponentChild[] | DynamicChildList;
