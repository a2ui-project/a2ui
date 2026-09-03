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

/** Internal extension of `ErrorConstructor` adding V8 `captureStackTrace` support. */
interface V8ErrorConstructor extends ErrorConstructor {
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
}

/**
 * Base class for all A2UI v0.8 specific errors.
 */
export class A2uiError extends Error {
  /** Machine-readable string identifying the error category. */
  public readonly code: string;

  /**
   * Initializes a new `A2uiError` instance.
   *
   * @param message Human-readable error description.
   * @param code Machine-readable error category code.
   */
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
 * Error thrown when JSON validation fails or schemas are mismatched.
 */
export class A2uiValidationError extends A2uiError {
  /**
   * Initializes a new `A2uiValidationError` instance.
   *
   * @param message Human-readable error description.
   * @param details Additional error details or issues.
   */
  constructor(
    message: string,
    public readonly details?: any,
  ) {
    super(message, 'VALIDATION_ERROR');
  }
}

/**
 * Error thrown during DataModel mutations (invalid paths, type mismatches).
 */
export class A2uiDataError extends A2uiError {
  /**
   * Initializes a new `A2uiDataError` instance.
   *
   * @param message Human-readable error description.
   * @param path Target data path.
   */
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message, 'DATA_ERROR');
  }
}

/**
 * Error thrown during string interpolation and function evaluation.
 */
export class A2uiExpressionError extends A2uiError {
  /**
   * Initializes a new `A2uiExpressionError` instance.
   *
   * @param message Human-readable error description.
   * @param expression Evaluated expression string.
   */
  constructor(
    message: string,
    public readonly expression?: string,
  ) {
    super(message, 'EXPRESSION_ERROR');
  }
}

/**
 * Error thrown for structural issues in the UI tree (missing surfaces, duplicate components).
 */
export class A2uiStateError extends A2uiError {
  /**
   * Initializes a new `A2uiStateError` instance.
   *
   * @param message Human-readable error description.
   */
  constructor(message: string) {
    super(message, 'STATE_ERROR');
  }
}
