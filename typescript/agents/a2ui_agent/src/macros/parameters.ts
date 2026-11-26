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
 * The parameter vocabulary of macros.
 *
 * It mirrors the parameter types of the shared macro conformance suite
 * (`conformance/agent/macros/README.md`): each type has a JSON Schema the model sees and a
 * coercion that turns the model's argument into the value `render` receives.
 */

import {ComponentChild} from '../component-tree/component-node.js';
import {
  AccessibilityAttributes,
  Action,
  CheckRule,
  ChildList,
  DynamicBoolean,
  DynamicNumber,
  DynamicString,
  DynamicStringList,
  DynamicValue,
} from './parameter-values.js';

/** The parameter types of the vocabulary. */
export type MacroParameterType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'component'
  | 'componentList'
  | 'childList'
  | 'action'
  | 'dynamicString'
  | 'dynamicNumber'
  | 'dynamicBoolean'
  | 'dynamicStringList'
  | 'dynamicValue'
  | 'checkRuleList'
  | 'accessibility';

/**
 * Whether an invocation must set a parameter: `required`, or `defaulted` and `optional`
 * when it may leave it out, with or without a default.
 */
export type ParameterPresence = 'required' | 'defaulted' | 'optional';

/** A macro parameter, as the `param` functions create it. */
export interface MacroParameter<T = unknown, P extends ParameterPresence = ParameterPresence> {
  readonly type: MacroParameterType;
  readonly presence: P;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly default?: T;
}

/** The parameters of a macro, by name. */
export type MacroParameters = Readonly<Record<string, MacroParameter>>;

export interface ParameterOptions<T> {
  /** Tells the model what the parameter is for. */
  description?: string;
  /** The value `render` receives when an invocation leaves the parameter out. */
  default?: T;
  /** `false` lets invocations leave the parameter out without a default. */
  required?: boolean;
}

export interface StringParameterOptions extends ParameterOptions<string> {
  /** The values the parameter accepts. */
  enum?: readonly string[];
}

/** The presence a parameter's options give it. */
export type PresenceOf<O> = O extends {default: unknown}
  ? 'defaulted'
  : O extends {required: false}
    ? 'optional'
    : 'required';

/** The value type of a string parameter: the union of its `enum`, or `string`. */
export type StringValue<O> = O extends {enum: readonly (infer E extends string)[]} ? E : string;

/** The value type of a parameter. */
export type ParameterValue<P> = P extends MacroParameter<infer T, ParameterPresence> ? T : never;

/**
 * The arguments `render` receives: a required parameter or one with a default has its
 * value, an optional parameter without a default has its value or `undefined`.
 */
export type MacroArgs<P extends MacroParameters> = {
  [K in keyof P]: P[K] extends MacroParameter<infer T, 'optional'>
    ? T | undefined
    : ParameterValue<P[K]>;
};

type OmittableKeys<P extends MacroParameters> = {
  [K in keyof P]: P[K] extends MacroParameter<unknown, 'required'> ? never : K;
}[keyof P];

/** The input of a direct `render` call, which may leave out parameters that aren't required. */
export type MacroInput<P extends MacroParameters> = {
  [K in Exclude<keyof P, OmittableKeys<P>>]: ParameterValue<P[K]>;
} & {
  [K in OmittableKeys<P>]?: ParameterValue<P[K]>;
};

type NoOptions = Record<never, never>;

function createParameter<T, P extends ParameterPresence>(
  type: MacroParameterType,
  options: StringParameterOptions | ParameterOptions<T> = {},
): MacroParameter<T, P> {
  const presence: ParameterPresence =
    options.default !== undefined
      ? 'defaulted'
      : options.required === false
        ? 'optional'
        : 'required';
  const parameter: {-readonly [K in keyof MacroParameter<T>]: MacroParameter<T>[K]} = {
    type,
    presence,
  };
  if (options.description !== undefined) parameter.description = options.description;
  if ('enum' in options && options.enum !== undefined) parameter.enum = [...options.enum];
  if (options.default !== undefined) parameter.default = options.default as T;
  return parameter as MacroParameter<T, P>;
}

function parameterOfType<T>(type: MacroParameterType) {
  return <const O extends ParameterOptions<T> = NoOptions>(
    options?: O,
  ): MacroParameter<T, PresenceOf<O>> => createParameter(type, options);
}

/**
 * Creates macro parameters.
 *
 * Each function takes `description`, `default` and `required: false`, and `string` also
 * takes `enum`. The comment on each says what an invocation may pass and what `render`
 * receives.
 */
export const param = {
  /** A string, or one of `enum`. */
  string: <const O extends StringParameterOptions = NoOptions>(
    options?: O,
  ): MacroParameter<StringValue<O>, PresenceOf<O>> =>
    createParameter<StringValue<O>, PresenceOf<O>>('string', options),
  /** An integer. */
  integer: parameterOfType<number>('integer'),
  /** A number. */
  number: parameterOfType<number>('number'),
  /** A boolean. */
  boolean: parameterOfType<boolean>('boolean'),
  /** The ID of a component on the surface. */
  component: parameterOfType<ComponentChild>('component'),
  /** A list of component IDs. */
  componentList: parameterOfType<ComponentChild[]>('componentList'),
  /** A list of component IDs, or a `{path, componentId}` template over a data model list. */
  childList: parameterOfType<ChildList>('childList'),
  /**
   * An `Action`. An invocation may also pass an event name, an event body
   * (`{name, context, userMessage}`), `{event: name, ...}`, or a bare `{'@call': ...}`.
   */
  action: parameterOfType<Action>('action'),
  /** A string, an `{'@path': ...}` binding or an `{'@call': ...}` function call. */
  dynamicString: parameterOfType<DynamicString>('dynamicString'),
  /** A number, a binding or a function call. */
  dynamicNumber: parameterOfType<DynamicNumber>('dynamicNumber'),
  /** A boolean, a binding or a function call. */
  dynamicBoolean: parameterOfType<DynamicBoolean>('dynamicBoolean'),
  /** A list of strings, a binding or a function call. */
  dynamicStringList: parameterOfType<DynamicStringList>('dynamicStringList'),
  /**
   * Any JSON value, a binding or a function call. An object is a binding only as
   * `{'@path': ...}` and a call only with `'@call'`; any other object is kept as a literal.
   */
  dynamicValue: parameterOfType<DynamicValue>('dynamicValue'),
  /** A list of `CheckRule`s. */
  checkRuleList: parameterOfType<CheckRule[]>('checkRuleList'),
  /**
   * `AccessibilityAttributes` for `render` to use. Without this parameter, an invocation's
   * `@accessibility` is merged onto the root of the lowered tree instead.
   */
  accessibility: parameterOfType<AccessibilityAttributes>('accessibility'),
};

const COMMON_TYPES = 'common_types.json#/$defs/';

const PARAMETER_SCHEMAS: Readonly<Record<MacroParameterType, Readonly<Record<string, unknown>>>> = {
  string: {type: 'string'},
  integer: {type: 'integer'},
  number: {type: 'number'},
  boolean: {type: 'boolean'},
  component: {$ref: `${COMMON_TYPES}Child`},
  componentList: {$ref: `${COMMON_TYPES}ChildList`},
  childList: {$ref: `${COMMON_TYPES}ChildList`},
  action: {$ref: `${COMMON_TYPES}Action`},
  dynamicString: {$ref: `${COMMON_TYPES}DynamicString`},
  dynamicNumber: {$ref: `${COMMON_TYPES}DynamicNumber`},
  dynamicBoolean: {$ref: `${COMMON_TYPES}DynamicBoolean`},
  dynamicStringList: {$ref: `${COMMON_TYPES}DynamicStringList`},
  dynamicValue: {$ref: `${COMMON_TYPES}DynamicValue`},
  checkRuleList: {type: 'array', items: {$ref: `${COMMON_TYPES}CheckRule`}},
  accessibility: {$ref: `${COMMON_TYPES}AccessibilityAttributes`},
};

/** The JSON Schema of a parameter in a macro's catalog entry. */
export function parameterSchema(parameter: MacroParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = structuredClone(PARAMETER_SCHEMAS[parameter.type]);
  if (parameter.enum !== undefined) {
    schema['enum'] = [...parameter.enum];
  }
  if (parameter.description !== undefined) {
    schema['description'] = parameter.description;
  }
  return schema;
}
