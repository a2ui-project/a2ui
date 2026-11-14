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

/**
 * @fileoverview TypeScript types of the A2UI common types
 * (`common_types.json#/$defs/*`), as the version-independent runtime reads
 * them (GenericBinder, DataContext, ExpressionParser) and as the generated
 * basic catalog props types (`generated-types.ts`) write them.
 *
 * Types only: nothing here validates. Values are validated against each
 * protocol version's own JSON Schema documents, so a v0.9 surface accepts
 * `path`/`call` and a v1.0 surface `@path`/`@call`, as each spec says. The
 * types accept both spellings because the runtime serves every version.
 */

/** The unique identifier of a component (`ComponentId`). */
export type ComponentId = string;

/** A reference to a single child component (`Child`). */
export type Child = ComponentId;

/** The unique identifier of a function call (`CallId`). */
export type CallId = string;

/** A binding to a data model value: `{path}` (v0.9) or `{'@path'}` (v1.0). */
export interface DataBinding {
  /** A JSON Pointer path to a value in the data model (v0.9). */
  path?: string;
  /** A JSON Pointer path to a value in the data model (v1.0). */
  '@path'?: string;
}

/** Alias of {@link DataBinding}. */
export type DataBindingType = DataBinding;

/** The return types a function call may declare. */
export type FunctionReturnType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'any'
  | 'void';

/** A call of a named function: `{call}` (v0.9) or `{'@call'}` (v1.0). */
export interface FunctionCall {
  /** The name of the function to call (v0.9). */
  call?: string;
  /** The name of the function to call (v1.0). */
  '@call'?: string;
  /** Arguments passed to the function. */
  args?: Record<string, unknown>;
  /** The expected return type of the function call. */
  returnType?: FunctionReturnType;
  /** The catalog of the function, overriding the surface's default catalog. */
  catalogId?: string;
}

/** Alias of {@link FunctionCall}. */
export type FunctionCallType = FunctionCall;

/** The envelope properties common to all function calls (`FunctionCommon`). */
export interface FunctionCommon {
  call?: string;
  '@call'?: string;
  catalogId?: string;
}

/** A string, or a binding or call that yields one. */
export type DynamicString = string | DataBinding | FunctionCall;
/** A number, or a binding or call that yields one. */
export type DynamicNumber = number | DataBinding | FunctionCall;
/** A boolean, or a binding or call that yields one (or a validation result). */
export type DynamicBoolean = boolean | DataBinding | FunctionCall;
/** A list of strings, or a binding or call that yields one. */
export type DynamicStringList = string[] | DataBinding | FunctionCall;
/** Any value, or a binding or call that yields one. */
export type DynamicValue =
  | string
  | number
  | boolean
  | unknown[]
  | DataBinding
  | FunctionCall
  | Record<string, unknown>;

/** Attributes for assistive technologies (`AccessibilityAttributes`). */
export interface AccessibilityAttributes {
  label?: DynamicString;
  description?: DynamicString;
  live?: 'off' | 'polite' | 'assertive';
  hidden?: DynamicBoolean;
}

/** Extension metadata keyed by UAX #31 identifiers (`Extensions`). */
export type Extensions = Record<string, unknown>;

/** Component-level metadata (`@metadata`). */
export interface ComponentMetadata {
  extensions?: Extensions;
}

/** The properties common to all components (`ComponentCommon`), envelope included. */
export interface ComponentCommon {
  id: ComponentId;
  accessibility?: AccessibilityAttributes;
  '@catalogId'?: string;
  '@accessibility'?: AccessibilityAttributes;
  '@metadata'?: ComponentMetadata;
}

/**
 * The properties of `ComponentCommon` a component's props carry: everything
 * but the envelope fields (`id`, `@catalogId`), which route the component.
 */
export type ComponentCommonProps = Omit<ComponentCommon, 'id' | '@catalogId'>;

/** A static list of child ids, or a template over a data model list (`ChildList`). */
export type ChildList = ComponentId[] | {componentId: ComponentId; path: string};

/** A validation check rule of an input component (`CheckRule`). */
export interface CheckRule {
  condition: DynamicBoolean | DataBinding | FunctionCall;
  message?: string;
}

/** The properties of components that support renderer-side checks (`Checkable`). */
export interface Checkable {
  checks?: CheckRule[];
  '@checks'?: CheckRule[];
}

/** An interaction handler: an event for the agent, or a function call (`Action`). */
export type Action =
  | {event: {name: string; userMessage?: DynamicString; context?: Record<string, unknown>}}
  | {functionCall: FunctionCall};

/** The `@index` system function (`IndexSystemFunction`). */
export interface IndexSystemFunction {
  call?: '@index';
  '@call'?: '@index';
  args?: {offset?: DynamicNumber};
}

/** The reserved root container of a surface (`Surface`). */
export interface Surface {
  component?: 'Surface';
  child?: 'root';
}

/** The response to a function call (`FunctionResponse`). */
export interface FunctionResponse {
  functionCallId: CallId;
  value?: unknown;
  error?: {code: string; message: string};
}
