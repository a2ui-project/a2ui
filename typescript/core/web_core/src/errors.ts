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
 * Error thrown during catalog management, loading, or resolution.
 *
 * Raised when a catalog declares no protocol version, fails schema validation,
 * or when a function call or component references an unresolvable catalog ID.
 */
export class A2uiCatalogError extends A2uiError {
  /**
   * Initializes a new `A2uiCatalogError` instance.
   *
   * @param message Human-readable error description.
   * @param code Machine-readable error category code. Defaults to `'CATALOG_ERROR'`.
   */
  constructor(message: string, code: string = 'CATALOG_ERROR') {
    super(message, code);
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

/**
 * Standard error codes for A2UI RPC failures.
 */
export enum RpcErrorCode {
  /** Malformed, missing, or unsupported function call payload or name. */
  INVALID_FUNCTION_CALL = 'INVALID_FUNCTION_CALL',

  /** Runtime failure or unhandled exception during function execution. */
  EXECUTION_ERROR = 'EXECUTION_ERROR',

  /** Requested function that is not registered in any available catalog. */
  UNKNOWN_FUNCTION = 'UNKNOWN_FUNCTION',

  /** Unspecified or unrecognized error condition. */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',

  /** Remote function call that timed out before receiving a response. */
  TIMEOUT = 'TIMEOUT',

  /** Function call that was cancelled or aborted before completing. */
  CANCELLED = 'CANCELLED',

  /** RPC handler disposal while a function call was pending or initiated. */
  DISPOSED = 'DISPOSED',

  /** Duplicate function call identifier that is already pending. */
  DUPLICATE = 'DUPLICATE',

  /** Missing outbound message listener required to transmit agent function calls. */
  NO_LISTENER = 'NO_LISTENER',
}

/**
 * Error thrown when an A2UI RPC operation fails, times out, or is cancelled.
 */
export class A2uiRpcError extends A2uiError {
  /**
   * Initializes a new `A2uiRpcError` instance.
   *
   * @param message Human-readable error description.
   * @param code Category code or string identifying the RPC error.
   * @param functionCallId Optional identifier of the failed function call.
   * @param details Optional structured error details.
   */
  constructor(
    message: string,
    code: RpcErrorCode | string = RpcErrorCode.UNKNOWN_ERROR,
    /** Identifier of the failed function call, if available. */
    public readonly functionCallId?: string,
    /** Structured error details or original error cause, if available. */
    public readonly details?: unknown,
  ) {
    const resolvedCode = code || RpcErrorCode.UNKNOWN_ERROR;
    super(`[${resolvedCode}] ${message}`, resolvedCode);
    this.name = 'A2uiRpcError';
  }
}
