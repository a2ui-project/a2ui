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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/v0_9/json/common_types.json via scripts/generate-basic-catalog-types.mjs

/**
 * These types describe values as a message writes them (the input shape of
 * the schemas). The defaults the schemas declare are filled in at runtime,
 * so a validated value may carry a property its type marks optional.
 */

/** A call of a function of the catalog the call runs in (`catalog.json#/$defs/anyFunction`). */
export type CatalogFunctionCall = {
  args?: Record<string, unknown>;
};

/**
 * The unique identifier for a component, used for both definitions and references within the same surface.
 */
export type ComponentId = string;

/**
 * Attributes to enhance accessibility when using assistive technologies like screen readers.
 */
export type AccessibilityAttributes = {
  /**
   * A short string, typically 1 to 3 words, used by assistive technologies to convey the purpose or intent of an element. For example, an input field might have an accessible label of 'User ID' or a button might be labeled 'Submit'.
   */
  label?: DynamicString;
  /**
   * Additional information provided by assistive technologies about an element such as instructions, format requirements, or result of an action. For example, a mute button might have a label of 'Mute' and a description of 'Silences notifications about this conversation'.
   */
  description?: DynamicString;
};

export type ComponentCommon = {
  id: ComponentId;
  accessibility?: AccessibilityAttributes;
};

export type ChildList =
  | Array<ComponentId>
  | {
      componentId: ComponentId;
      /**
       * The path to the list of component property objects in the data model.
       */
      path: string;
    };

export type DataBinding = {
  /**
   * A JSON Pointer path to a value in the data model.
   */
  path: string;
};

/**
 * A value that can be a literal, a path, or a function call returning any type.
 */
export type DynamicValue = string | number | boolean | Array<unknown> | DataBinding | FunctionCall;

/**
 * Represents a string
 */
export type DynamicString =
  | string
  | DataBinding
  | (FunctionCall & {
      returnType?: 'string';
    });

/**
 * Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.
 */
export type DynamicNumber =
  | number
  | DataBinding
  | (FunctionCall & {
      returnType?: 'number';
    });

/**
 * A boolean value that can be a literal, a path, or a function call returning a boolean.
 */
export type DynamicBoolean =
  | boolean
  | DataBinding
  | (FunctionCall & {
      returnType?: 'boolean';
    });

/**
 * Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.
 */
export type DynamicStringList =
  | Array<string>
  | DataBinding
  | (FunctionCall & {
      returnType?: 'array';
    });

/**
 * Invokes a named function on the client.
 */
export type FunctionCall = {
  /**
   * The name of the function to call.
   */
  call: string;
  /**
   * Arguments passed to the function.
   */
  args?: {
    [key: string]: DynamicValue | Record<string, unknown>;
  };
  /**
   * The expected return type of the function call.
   */
  returnType?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
} & CatalogFunctionCall;

/**
 * A single validation rule applied to an input component.
 */
export type CheckRule = {
  condition: DynamicBoolean;
  /**
   * The error message to display if the check fails.
   */
  message: string;
};

/**
 * Properties for components that support client-side checks.
 */
export type Checkable = {
  /**
   * A list of checks to perform. These are function calls that must return a boolean indicating validity.
   */
  checks?: Array<CheckRule>;
};

/**
 * Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.
 */
export type Action =
  | {
      /**
       * The event to dispatch to the server.
       */
      event: {
        /**
         * The name of the action to be dispatched to the server.
         */
        name: string;
        /**
         * A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.
         */
        context?: {
          [key: string]: DynamicValue;
        };
      };
    }
  | {
      functionCall: FunctionCall;
    };

/**
 * The properties of `ComponentCommon` a component's props carry: all but the
 * envelope fields (`id`, `@catalogId`), which route the component.
 */
export type ComponentCommonProps = Omit<ComponentCommon, 'id' | '@catalogId'>;
