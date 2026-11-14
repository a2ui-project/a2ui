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
// Generated from specification/v1_0/json/common_types.json via scripts/generate-basic-catalog-types.mjs

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
 * The unique identifier for a function call.
 */
export type CallId = string;

/**
 * Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding.
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
  /**
   * Controls screen reader announcements for dynamic updates (WAI-ARIA aria-live). 'polite' waits for user pause; 'assertive' interrupts immediately for alerts.
   */
  live?: 'off' | 'polite' | 'assertive';
  /**
   * Hides the element and its children from assistive technologies when true. Default is false.
   */
  hidden?: DynamicBoolean;
};

/**
 * Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions.
 */
export type Extensions = Record<string, unknown>;

export type ComponentCommon = {
  id: ComponentId;
  /**
   * The catalog ID for this component, overriding any surface-level default catalogId.
   */
  '@catalogId'?: string;
  '@accessibility'?: AccessibilityAttributes;
  /**
   * Optional component-level metadata for vendor extensions.
   */
  '@metadata'?: {
    extensions?: Extensions;
  };
};

/**
 * A reference to a single child component ID.
 */
export type Child = ComponentId;

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
  '@path': string;
};

/**
 * A value that can be a literal, a path, or a function call returning any type.
 */
export type DynamicValue =
  | string
  | number
  | boolean
  | Array<unknown>
  | Record<string, unknown>
  | DataBinding
  | FunctionCall;

/**
 * Represents a string
 */
export type DynamicString = string | DataBinding | FunctionCall;

/**
 * Represents a value that can be either a literal number, a path to a number in the data model, or a function call returning a number.
 */
export type DynamicNumber = number | DataBinding | FunctionCall;

/**
 * A boolean value that can be a literal, a path, or a function call returning a boolean or a validation result object (coerced to its 'valid' boolean).
 */
export type DynamicBoolean = boolean | DataBinding | FunctionCall;

/**
 * Represents a value that can be either a literal array of strings, a path to a string array in the data model, or a function call returning a string array.
 */
export type DynamicStringList = Array<string> | DataBinding | FunctionCall;

/**
 * Baseline envelope properties common to all function calls. Function-specific argument schemas ('args') are defined individually by each function in the active catalog.
 */
export type FunctionCommon = {
  /**
   * The name of the function to call.
   */
  '@call': string;
  /**
   * The catalog ID for this function, overriding any surface-level default catalogId.
   */
  catalogId?: string;
};

/**
 * Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context.
 */
export type IndexSystemFunction = {
  '@call': '@index';
  args?: {
    /**
     * Optional. An offset to add to the 0-based index (e.g., 1 for 1-based indexing). Defaults to 0.
     */
    offset?: DynamicNumber;
  };
};

/**
 * Invokes a named function, combining common function properties with the catalog function definition.
 */
export type FunctionCall = FunctionCommon & (CatalogFunctionCall | IndexSystemFunction);

/**
 * A single validation check rule applied to an input component. The condition function or path evaluates to a structured validation result object or a boolean (which is coerced to a validation result object).
 */
export type CheckRule = {
  /**
   * Path or function call evaluating to a structured validation result object or a boolean.
   */
  condition: DataBinding | FunctionCall;
  /**
   * Optional fallback error message.
   */
  message?: string;
};

/**
 * Properties for components that support renderer-side checks.
 */
export type Checkable = {
  /**
   * A list of validation check rules to perform on the component.
   */
  '@checks'?: Array<CheckRule>;
};

/**
 * Defines an interaction handler that can either trigger an agent-side event or execute a local renderer-side function.
 */
export type Action =
  | {
      /**
       * The event to dispatch to the agent.
       */
      event: {
        /**
         * The name of the action to be dispatched to the agent.
         */
        name: string;
        /**
         * An optional human-readable message describing the action performed by the user, resolved by the renderer and included in the outbound action message.
         */
        userMessage?: DynamicString;
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
 * The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has 'child': 'root'.
 */
export type Surface = {
  component?: 'Surface';
  child?: 'root';
};

/**
 * The return response matching a callAgentFunction or callRendererFunction invocation.
 */
export type FunctionResponse = {
  /**
   * The unique ID matching the initiating function call.
   */
  functionCallId: CallId;
  /**
   * The return value of the function.
   */
  value?: unknown;
  /**
   * An error object indicating failure of the function execution.
   */
  error?: {
    code: string;
    message: string;
  };
} & (unknown | unknown);

/**
 * The properties of `ComponentCommon` a component's props carry: all but the
 * envelope fields (`id`, `@catalogId`), which route the component.
 */
export type ComponentCommonProps = Omit<ComponentCommon, 'id' | '@catalogId'>;
