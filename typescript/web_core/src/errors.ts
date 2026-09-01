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
  /** Captures a V8 stack trace onto the target object. */
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;
}

/**
 * Base class for all A2UI specific errors.
 *
 * Includes a machine-readable `code` for categorical handling and ensures
 * proper stack trace capturing.
 *
 * @example
 * ```ts
 * throw new A2uiError('Failed to process payload', 'PROCESSING_ERROR');
 * ```
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
 * Error thrown when JSON validation fails or schema validation mismatches occur.
 */
export class A2uiValidationError extends A2uiError {
  /**
   * Initializes a new `A2uiValidationError` instance.
   *
   * @param message Error description detailing the validation failure.
   * @param details Additional error context or Zod validation issues.
   * @param code Optional error category code.
   */
  constructor(
    message: string,
    public readonly details?: any,
    code: string = 'VALIDATION_ERROR',
  ) {
    super(message, code);
  }
}

/**
 * Error thrown during DataModel mutations (invalid paths, type mismatches).
 */
export class A2uiDataError extends A2uiError {
  /**
   * Initializes a new `A2uiDataError` instance.
   *
   * @param message Error description.
   * @param path Target data model path where the mutation failed.
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
   * @param message Error description.
   * @param expression Evaluated expression string.
   * @param details Additional error details.
   */
  constructor(
    message: string,
    public readonly expression?: string,
    public readonly details?: any,
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
   * @param message Error description.
   */
  constructor(message: string) {
    super(message, 'STATE_ERROR');
  }
}

/**
 * Error thrown when component tree integrity checks fail (duplicate IDs, dangling references, missing root).
 */
export class A2uiIntegrityError extends A2uiValidationError {
  /**
   * Initializes a new `A2uiIntegrityError` instance.
   *
   * @param message Error description.
   * @param details Additional error details.
   * @param code Error category code. Defaults to 'INTEGRITY_ERROR'.
   */
  constructor(message: string, details?: any, code: string = 'INTEGRITY_ERROR') {
    super(message, details, code);
    this.name = 'A2uiIntegrityError';
  }
}

/**
 * Error thrown when global or function call recursion depth limits are exceeded.
 */
export class A2uiRecursionError extends A2uiValidationError {
  /**
   * Initializes a new `A2uiRecursionError` instance.
   *
   * @param message Error description.
   * @param details Additional error details.
   * @param code Error category code. Defaults to 'RECURSION_ERROR'.
   */
  constructor(message: string, details?: any, code: string = 'RECURSION_ERROR') {
    super(message, details, code);
    this.name = 'A2uiRecursionError';
  }
}
