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

import {ComponentNode} from '../component-tree/component-node.js';
import {isValidUax31Identifier} from '../internal/web-core.js';
import {MacroProtocolError} from './macro-protocol-error.js';
import {MacroArgs, MacroInput, MacroParameters, parameterSchema} from './parameters.js';

/** What `defineMacro` takes. */
export interface MacroConfig<P extends MacroParameters> {
  /** The component name the model writes. A UAX #31 identifier other than `Surface`. */
  name: string;
  /** Tells the model what the macro is for. */
  description?: string;
  parameters?: P;
  /**
   * Builds the component tree that an invocation lowers to. The root takes the ID of the
   * invocation and every other ID is namespaced under it, so an invocation can be used
   * more than once on a surface.
   */
  render: (args: MacroArgs<P>) => ComponentNode;
}

/** A macro, as `defineMacro` returns it. */
export interface MacroDefinition<P extends MacroParameters = MacroParameters> {
  readonly name: string;
  readonly description?: string;
  readonly parameters: P;
  /**
   * Builds the macro's tree with the defaults applied. Call it from another macro's
   * `render` to inline this macro's tree there.
   */
  render(input: MacroInput<P>): ComponentNode;
}

/**
 * Defines a macro: a component the model can use that lowers to a tree of catalog
 * components before the messages reach the renderer.
 *
 * @throws {A2uiValidationError} If the name is not a valid v1.0 component name.
 */
export function defineMacro<const P extends MacroParameters = Record<never, never>>(
  config: MacroConfig<P>,
): MacroDefinition<P> {
  validateMacroName(config.name);
  const parameters = config.parameters ?? ({} as P);
  const definition: MacroDefinition<P> = {
    name: config.name,
    parameters,
    render: input => config.render(withDefaults(parameters, input)),
  };
  return config.description === undefined
    ? definition
    : {...definition, description: config.description};
}

function withDefaults<P extends MacroParameters>(
  parameters: P,
  input: MacroInput<P>,
): MacroArgs<P> {
  const given = input as Record<string, unknown>;
  const args: Record<string, unknown> = {};
  for (const [name, parameter] of Object.entries(parameters)) {
    args[name] = given[name] === undefined ? parameter.default : given[name];
  }
  return args as MacroArgs<P>;
}

/** Whether `name` is the reserved component name `Surface`, also in a compatibility form. */
export function isReservedComponentName(name: string): boolean {
  return name.normalize('NFKC') === 'Surface';
}

/**
 * Throws unless `name` can name a v1.0 component.
 *
 * @throws {A2uiValidationError} If `name` is `Surface` or not a UAX #31 identifier.
 */
export function validateMacroName(name: string): void {
  if (isReservedComponentName(name)) {
    throw new MacroProtocolError(
      "Macro name 'Surface' is reserved and cannot be used as a component name.",
    );
  }
  if (!isValidUax31Identifier(name)) {
    throw new MacroProtocolError(`Macro name '${name}' must be a valid Unicode identifier.`);
  }
}

/** The catalog entry of a macro: its parameters as a v1.0 component schema. */
export function macroComponentSchema(definition: MacroDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {component: {const: definition.name}};
  const required = ['component'];
  for (const [name, parameter] of Object.entries(definition.parameters)) {
    properties[name] = parameterSchema(parameter);
    if (parameter.presence === 'required') {
      required.push(name);
    }
  }
  const schema: Record<string, unknown> = {type: 'object', properties, required};
  if (definition.description !== undefined) {
    schema['description'] = definition.description;
  }
  return schema;
}
