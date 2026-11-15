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
 * The v0.8 component property types, as `server_to_client_with_standard_catalog.json`
 * and the v0.8 renderers read them. `literal` is the shorthand some v0.8
 * agents write for `literalString`, `literalNumber` and `literalBoolean`.
 */

import type {StringValue} from './primitives.js';

export declare interface Action {
  /** A unique name identifying the action (e.g., 'submitForm'). */
  name: string;
  /** A key-value map of data bindings to be resolved when the action is triggered. */
  context?: Array<{
    key: string;
    /** The dynamic value. Define EXACTLY ONE of the nested properties. */
    value: {
      /** A data binding reference to a location in the data model (e.g., '/user/name'). */
      path?: string;
      /** A fixed, hardcoded string value. */
      literalString?: string;
      literalNumber?: number;
      literalBoolean?: boolean;
    };
  }>;
}

export declare interface Text {
  text: StringValue;
  usageHint?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';
}

export declare interface Image {
  url: StringValue;
  usageHint?: 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  altText?: StringValue;
}

export declare interface Icon {
  name: StringValue;
}

export declare interface Video {
  url: StringValue;
}

export declare interface AudioPlayer {
  url: StringValue;
  /** A label, title, or placeholder text. */
  description?: StringValue;
}

export declare interface Tabs {
  /** A list of tabs, each with a title and a child component ID. */
  tabItems: Array<{
    title: {
      /** A data binding reference to a location in the data model (e.g., '/user/name'). */
      path?: string;
      /** A fixed, hardcoded string value. */
      literalString?: string;
    };
    /** A reference to a component instance by its unique ID. */
    child: string;
  }>;
}

/** A template for generating a dynamic list of children from a data model list. */
interface ChildTemplate {
  componentId: string;
  dataBinding: string;
}

/** A list of child components, either explicitly or via a template. */
interface Children {
  explicitList?: string[];
  template?: ChildTemplate;
}

export declare interface Row {
  children: Children;
  distribution?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

export declare interface Column {
  children: Children;
  distribution?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

export declare interface List {
  children: Children;
  direction?: 'vertical' | 'horizontal';
  alignment?: 'start' | 'center' | 'end' | 'stretch';
}

export declare interface Button {
  /** The ID of the component to display as the button's content. */
  child: string;
  /** Represents a user-initiated action. */
  action: Action;
  /** Indicates if this button should be styled as the primary action. */
  primary?: boolean;
}

export declare interface Modal {
  /** The ID of the component (e.g., a button) that triggers the modal. */
  entryPointChild: string;
  /** The ID of the component to display as the modal's content. */
  contentChild: string;
}

export declare interface Card {
  /** The ID of the component to be rendered inside the card. */
  child: string;
}

export declare interface Divider {
  /** The orientation. */
  axis?: 'horizontal' | 'vertical';
  /** The color of the divider (e.g., hex code or semantic name). */
  color?: string;
  /** The thickness of the divider. */
  thickness?: number;
}

export declare interface TextField {
  text?: StringValue;
  /** A label, title, or placeholder text. */
  label: StringValue;
  textFieldType?: 'shortText' | 'number' | 'date' | 'longText' | 'obscured';
  /** A regex string to validate the input. */
  validationRegexp?: string;
}

export declare interface Checkbox {
  label: StringValue;
  value: {
    /** A data binding reference to a location in the data model (e.g., '/user/name'). */
    path?: string;
    literalBoolean?: boolean;
  };
}

export declare interface DateTimeInput {
  value: StringValue;
  enableDate?: boolean;
  enableTime?: boolean;
  /** The string format for the output (e.g., 'YYYY-MM-DD'). */
  outputFormat?: string;
}

export declare interface MultipleChoice {
  selections: {
    /** A data binding reference to a location in the data model (e.g., '/user/name'). */
    path?: string;
    literalArray?: string[];
  };
  options?: Array<{
    label: {
      /** A data binding reference to a location in the data model (e.g., '/user/name'). */
      path?: string;
      /** A fixed, hardcoded string value. */
      literalString?: string;
    };
    value: string;
  }>;
  maxAllowedSelections?: number;
  type?: 'checkbox' | 'chips';
  filterable?: boolean;
}

export declare interface Slider {
  value: {
    /** A data binding reference to a location in the data model (e.g., '/user/name'). */
    path?: string;
    literalNumber?: number;
  };
  minValue?: number;
  maxValue?: number;
  label?: StringValue;
}
