/*
 * Copyright 2026 Google LLC
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

import {A2uiError} from '../../internal/web_core.js';

/**
 * Base class for all Express DSL compilation errors.
 */
export class ExpressCompilerError extends A2uiError {
  readonly helpMessage?: string;

  constructor(message: string, helpMessage?: string) {
    super(message, 'EXPRESS_COMPILER_ERROR');
    this.name = 'ExpressCompilerError';
    this.helpMessage = helpMessage;
  }
}

/**
 * Base class for blocks the compiler cannot read.
 *
 * The block is malformed on its own terms, so the compiler never reaches the
 * point of asking the catalog about anything it names.
 */
export class ExpressParseError extends ExpressCompilerError {
  constructor(message: string, helpMessage?: string) {
    super(message, helpMessage);
    this.name = 'ExpressParseError';
  }
}

/**
 * Base class for readable blocks the catalog refuses.
 *
 * The block parses; what it names or the value it gives is what the catalog
 * does not admit.
 */
export class ExpressValidationError extends ExpressCompilerError {
  constructor(message: string, helpMessage?: string) {
    super(message, helpMessage);
    this.name = 'ExpressValidationError';
  }
}

/**
 * Raised when a component is not defined in the catalog.
 */
export class ExpressUnknownComponentError extends ExpressValidationError {
  readonly compName: string;

  constructor(compName: string) {
    super(`Component '${compName}' is not defined in the catalog.`);
    this.name = 'ExpressUnknownComponentError';
    this.compName = compName;
  }
}

/**
 * Raised when a component is missing a property its catalog schema requires.
 */
export class ExpressMissingRequiredPropertyError extends ExpressValidationError {
  readonly compName: string;
  readonly propName: string;

  constructor(compName: string, propName: string) {
    super(`Component '${compName}' is missing required property '${propName}'.`);
    this.name = 'ExpressMissingRequiredPropertyError';
    this.compName = compName;
    this.propName = propName;
  }
}

/**
 * Raised when a component argument is not a valid property in the catalog schema.
 */
export class ExpressUnknownPropertyError extends ExpressValidationError {
  readonly compName: string;
  readonly propName: string;
  readonly validProps: string[];

  constructor(compName: string, propName: string, validProps: string[]) {
    const msg = `Property '${propName}' is not a valid property of component '${compName}'.`;
    const helpMsg =
      validProps.length > 0
        ? `Component '${compName}' accepts properties: ${[...validProps].sort().join(', ')}.`
        : `Component '${compName}' has no configurable properties.`;
    super(msg, helpMsg);
    this.name = 'ExpressUnknownPropertyError';
    this.compName = compName;
    this.propName = propName;
    this.validProps = validProps;
  }
}

/**
 * Raised when a property is provided multiple times for a single component instance.
 */
export class ExpressDuplicatePropertyError extends ExpressValidationError {
  readonly compName: string;
  readonly propName: string;

  constructor(compName: string, propName: string) {
    const msg = `Property '${propName}' of component '${compName}' was provided multiple times.`;
    const helpMsg = `Remove duplicate specification of property '${propName}' for component '${compName}'.`;
    super(msg, helpMsg);
    this.name = 'ExpressDuplicatePropertyError';
    this.compName = compName;
    this.propName = propName;
  }
}

/**
 * Raised when a function is not defined in the catalog.
 */
export class ExpressUnknownFunctionError extends ExpressValidationError {
  readonly fnName: string;

  constructor(fnName: string) {
    super(`Function '${fnName}' is not defined in the catalog.`);
    this.name = 'ExpressUnknownFunctionError';
    this.fnName = fnName;
  }
}

/**
 * Raised when a function argument is not a valid parameter in the function schema.
 */
export class ExpressInvalidParamError extends ExpressValidationError {
  readonly fnName: string;
  readonly paramName: string;
  readonly validParams: string[];

  constructor(fnName: string, paramName: string, validParams: string[]) {
    const msg = `Argument '${paramName}' is not a valid parameter of function '${fnName}'.`;
    const helpMsg =
      validParams.length > 0
        ? `Function '${fnName}' accepts parameters: ${[...validParams].sort().join(', ')}.`
        : `Function '${fnName}' accepts no parameters.`;
    super(msg, helpMsg);
    this.name = 'ExpressInvalidParamError';
    this.fnName = fnName;
    this.paramName = paramName;
    this.validParams = validParams;
  }
}

/**
 * Raised when a function parameter is provided multiple times.
 */
export class ExpressDuplicateParamError extends ExpressValidationError {
  readonly fnName: string;
  readonly paramName: string;

  constructor(fnName: string, paramName: string) {
    const msg = `Argument '${paramName}' of function '${fnName}' was provided multiple times.`;
    const helpMsg = `Remove duplicate specification of parameter '${paramName}' for function '${fnName}'.`;
    super(msg, helpMsg);
    this.name = 'ExpressDuplicateParamError';
    this.fnName = fnName;
    this.paramName = paramName;
  }
}

/**
 * Raised when dynamic databinding ($path) is used on a property that forbids databinding.
 */
export class ExpressForbiddenDatabindingError extends ExpressValidationError {
  readonly compName: string;
  readonly propName: string;

  constructor(compName: string, propName: string) {
    const msg = `Property '${propName}' of component '${compName}' does not support dynamic data bindings (paths).`;
    const helpMsg = `Property '${propName}' on '${compName}' must be a static literal value, not a dynamic databinding ($path).`;
    super(msg, helpMsg);
    this.name = 'ExpressForbiddenDatabindingError';
    this.compName = compName;
    this.propName = propName;
  }
}

/**
 * Raised when a root component reference is missing from the DSL.
 */
export class ExpressUndefinedRootError extends ExpressParseError {
  readonly rootTarget: string;

  constructor(rootTarget: string) {
    const msg = `Root target '${rootTarget}' is not defined.`;
    const helpMsg = `Ensure root component '${rootTarget}' is assigned in your Express DSL.`;
    super(msg, helpMsg);
    this.name = 'ExpressUndefinedRootError';
    this.rootTarget = rootTarget;
  }
}

/**
 * Raised when a child component variable reference is missing from the DSL.
 */
export class ExpressUndefinedChildError extends ExpressParseError {
  readonly childId: string;

  constructor(childId: string) {
    const msg = `Child target '${childId}' is not defined.`;
    const helpMsg = `Ensure component reference '${childId}' is defined in your Express DSL.`;
    super(msg, helpMsg);
    this.name = 'ExpressUndefinedChildError';
    this.childId = childId;
  }
}

/**
 * Raised when a lexer or parser syntax error is encountered in the Express DSL.
 */
export class ExpressSyntaxError extends ExpressParseError {
  readonly line: number;
  readonly column: number;
  readonly isLexer: boolean;

  constructor(message: string, line: number, column: number, isLexer: boolean) {
    super(message);
    this.name = 'ExpressSyntaxError';
    this.line = line;
    this.column = column;
    this.isLexer = isLexer;
  }
}

/**
 * Raised when a generated inline component ID collides with an existing component or variable ID.
 */
export class ExpressIdCollisionError extends ExpressValidationError {
  readonly idName: string;
  constructor(idName: string) {
    super(
      `Generated inline component ID '${idName}' collides with an existing component or variable ID.`,
    );
    this.name = 'ExpressIdCollisionError';
    this.idName = idName;
  }
}

/**
 * Thrown when attempting to decompile an ID or variable name that is not
 * a valid Express identifier (e.g. contains hyphens or is a reserved keyword).
 */
export class ExpressInvalidIdentifierError extends ExpressValidationError {
  constructor(id: string) {
    super(
      `Cannot decompile component id '${id}' because it is not a valid Express identifier.`,
      'Express identifiers must start with a letter or underscore, contain only alphanumeric characters and underscores, and cannot be a reserved word (true, false, null or _).',
    );
    this.name = 'ExpressInvalidIdentifierError';
  }
}

/**
 * Raised when a `surface(...)` line names a catalog that is not one of the active
 * catalogs.
 */
export class ExpressUnknownCatalogError extends ExpressValidationError {
  readonly catalogId: string;

  constructor(catalogId: string, activeCatalogIds: string[]) {
    super(
      `Catalog '${catalogId}' is not one of the active catalogs: ${activeCatalogIds.map(id => `'${id}'`).join(', ')}.`,
    );
    this.name = 'ExpressUnknownCatalogError';
    this.catalogId = catalogId;
  }
}
