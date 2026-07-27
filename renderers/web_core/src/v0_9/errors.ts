/*
 * Copyright 2025 Google LLC
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
 * This interface is needed for typescript to allow us to access the V8-only
 * `captureStackTrace` property in Errors.
 */
interface V8ErrorConstructor extends ErrorConstructor {
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
}

/**
 * Base class for all A2UI specific errors.
 *
 * Includes a machine-readable `code` for categorical handling and ensures
 * proper stack trace capturing.
 */
export class A2uiError extends Error {
  /** A machine-readable string identifying the error category. */
  public readonly code: string;

  constructor(message: string, code: string = 'UNKNOWN_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if ((Error as V8ErrorConstructor).captureStackTrace) {
      (Error as V8ErrorConstructor).captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when JSON validation fails or schemas are mismatched.
 */
export class A2uiValidationError extends A2uiError {
  constructor(
    message: string,
    public readonly details?: any,
  ) {
    super(message, 'VALIDATION_ERROR');
  }
}

/**
 * Thrown during DataModel mutations (invalid paths, type mismatches).
 */
export class A2uiDataError extends A2uiError {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message, 'DATA_ERROR');
  }
}

/**
 * Thrown during string interpolation and function evaluation.
 */
export class A2uiExpressionError extends A2uiError {
  constructor(
    message: string,
    public readonly expression?: string,
    public readonly details?: any,
  ) {
    super(message, 'EXPRESSION_ERROR');
  }
}

/**
 * Thrown for structural issues in the UI tree (missing surfaces, duplicate components).
 */
export class A2uiStateError extends A2uiError {
  constructor(message: string) {
    super(message, 'STATE_ERROR');
  }
}
