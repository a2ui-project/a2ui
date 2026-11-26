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

import {A2uiValidationError} from '../internal/web-core.js';
import {MacroDefinition} from './define-macro.js';
import {MacroParameter} from './parameters.js';

type JsonObject = Record<string, unknown>;

/**
 * Turns the arguments of an invocation into the arguments `render` receives.
 *
 * Every argument must match its parameter, in one of the forms `param` lists for it, and
 * the shorthands for an action become a full `Action`. A parameter the invocation leaves
 * out, or sets to `null`, gets its default.
 *
 * @throws {A2uiValidationError} If an argument has no parameter or doesn't match it, or a
 *     required parameter has no argument.
 */
export function coerceArguments(
  macro: MacroDefinition,
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(macro.parameters, name)) {
      throw new A2uiValidationError(`Macro '${macro.name}' has no parameter '${name}'.`);
    }
  }
  const coerced: Record<string, unknown> = {};
  for (const [name, parameter] of Object.entries(macro.parameters)) {
    const value = args[name];
    if (value === undefined || value === null) {
      if (parameter.presence === 'required') {
        throw new A2uiValidationError(`Macro '${macro.name}' requires parameter '${name}'.`);
      }
      coerced[name] = parameter.default;
      continue;
    }
    coerced[name] = coerceValue(value, parameter, `'${name}' of macro '${macro.name}'`);
  }
  return coerced;
}

function coerceValue(value: unknown, parameter: MacroParameter, where: string): unknown {
  const mismatch = (expected: string) =>
    new A2uiValidationError(
      `Parameter ${where} expects ${expected}, got ${JSON.stringify(value)}.`,
    );
  switch (parameter.type) {
    case 'string':
      if (typeof value !== 'string') throw mismatch('a string');
      if (parameter.enum !== undefined && !parameter.enum.includes(value)) {
        throw mismatch(`one of ${JSON.stringify(parameter.enum)}`);
      }
      return value;
    case 'integer':
      if (!Number.isInteger(value)) throw mismatch('an integer');
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw mismatch('a number');
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw mismatch('a boolean');
      return value;
    case 'component':
      if (typeof value !== 'string') throw mismatch('a component ID');
      return value;
    case 'componentList':
      if (!isStringArray(value)) throw mismatch('a list of component IDs');
      return value;
    case 'childList':
      if (!isStringArray(value) && !isDynamicChildList(value)) {
        throw mismatch('a list of component IDs or a {path, componentId} template');
      }
      return value;
    case 'action': {
      const action = toAction(value);
      if (action === undefined) throw mismatch('an action');
      return action;
    }
    case 'dynamicString':
      if (typeof value !== 'string' && !isBindingOrCall(value)) throw mismatch('a dynamic string');
      return value;
    case 'dynamicNumber':
      if (typeof value !== 'number' && !isBindingOrCall(value)) throw mismatch('a dynamic number');
      return value;
    case 'dynamicBoolean':
      if (typeof value !== 'boolean' && !isBindingOrCall(value)) {
        throw mismatch('a dynamic boolean');
      }
      return value;
    case 'dynamicStringList':
      if (!isStringArray(value) && !isBindingOrCall(value)) {
        throw mismatch('a dynamic string list');
      }
      return value;
    case 'dynamicValue':
      // Bindings, calls and literals all pass as written. A `{path}` or `{call}` object
      // stays a literal object, since v1.0 binds only with `@path` and calls with `@call`.
      return value;
    case 'checkRuleList':
      if (!Array.isArray(value) || !value.every(isCheckRule)) {
        throw mismatch('a list of check rules');
      }
      return value;
    case 'accessibility':
      if (!isJsonObject(value) || !Object.keys(value).every(key => ACCESSIBILITY_KEYS.has(key))) {
        throw mismatch('accessibility attributes');
      }
      return value;
  }
}

const ACCESSIBILITY_KEYS: ReadonlySet<string> = new Set(['label', 'description', 'live', 'hidden']);

/**
 * Turns the forms a model writes for an action into an `Action`: an event name, an event
 * body (`{name, context, userMessage}`), `{event: name, ...}` with the event body's other
 * fields beside it, or a function call (`{'@call': ...}`). A full `Action` is kept.
 *
 * @returns The action, or `undefined` if `value` is none of these.
 */
function toAction(value: unknown): JsonObject | undefined {
  if (typeof value === 'string') {
    return {event: {name: value}};
  }
  if (!isJsonObject(value)) {
    return undefined;
  }
  const {event, ...rest} = value;
  if (typeof event === 'string' && !('functionCall' in value)) {
    return {event: {...rest, name: event}};
  }
  if (event === undefined && !('functionCall' in value)) {
    if (isFunctionCall(value)) {
      return {functionCall: value};
    }
    return typeof value['name'] === 'string' ? {event: value} : undefined;
  }
  const isEvent = isJsonObject(event) && typeof event['name'] === 'string';
  const isCall = event === undefined && isFunctionCall(value['functionCall']);
  return (isEvent && !('functionCall' in value)) || isCall ? value : undefined;
}

function isCheckRule(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    isBindingOrCall(value['condition']) &&
    (value['message'] === undefined || typeof value['message'] === 'string')
  );
}

function isDynamicChildList(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    Object.keys(value).length === 2 &&
    typeof value['path'] === 'string' &&
    typeof value['componentId'] === 'string'
  );
}

/** Whether `value` is a data binding (`{'@path': ...}`) or a function call. */
function isBindingOrCall(value: unknown): boolean {
  return isFunctionCall(value) || isDataBinding(value);
}

function isDataBinding(value: unknown): boolean {
  return (
    isJsonObject(value) && Object.keys(value).length === 1 && typeof value['@path'] === 'string'
  );
}

function isFunctionCall(value: unknown): value is JsonObject {
  return isJsonObject(value) && typeof value['@call'] === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
