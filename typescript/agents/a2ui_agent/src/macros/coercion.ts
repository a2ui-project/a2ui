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

/**
 * Turns the arguments of an invocation into the arguments `render` receives.
 *
 * Every argument must match its parameter. A parameter the invocation leaves out, or sets
 * to `null`, gets its default.
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
    case 'childList':
      if (!isStringArray(value)) throw mismatch('a list of component IDs');
      return value;
    default:
      return value;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
