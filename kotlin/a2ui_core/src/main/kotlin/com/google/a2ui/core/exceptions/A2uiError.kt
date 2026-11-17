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

package com.google.a2ui.core.exceptions

/** Standardized machine-readable error codes for bidirectional RPC calls (v1.0+). */
enum class RpcErrorCode {
  INVALID_FUNCTION_CALL,
  UNKNOWN_FUNCTION,
  EXECUTION_ERROR,
  TIMEOUT,
  CANCELLED,
  DISPOSED,
  DUPLICATE,
  TOO_MANY_PENDING,
  NO_LISTENER,
  UNKNOWN_ERROR,
}

/** Structured diagnostic detail attached to validation or integrity exceptions. */
data class A2uiErrorDetail(val path: String, val code: String, val message: String)

/**
 * Root runtime exception for all A2UI Core and Agent SDK failures.
 *
 * Mirrors the hierarchy in `a2ui_core.blueprint.md` §3.G: [A2uiIntegrityError] and
 * [A2uiRecursionError] inherit from [A2uiValidationError] so callers catching validation failures
 * capture structural and topological rejections uniformly across SDKs.
 */
open class A2uiError(
  message: String,
  cause: Throwable? = null,
  val details: List<A2uiErrorDetail> = emptyList(),
) : RuntimeException(message, cause)

/** Raised when wire envelopes, identifiers, or component properties violate schema contracts. */
open class A2uiValidationError(
  message: String,
  cause: Throwable? = null,
  details: List<A2uiErrorDetail> = emptyList(),
) : A2uiError(message, cause, details)

/** Raised when loading, negotiating, or resolving component catalogs fails. */
open class A2uiCatalogError(
  message: String,
  cause: Throwable? = null,
  details: List<A2uiErrorDetail> = emptyList(),
) : A2uiError(message, cause, details)

/** Raised when surface lifecycle, root presence, cycles, or parent-child links are broken. */
open class A2uiIntegrityError(
  message: String,
  cause: Throwable? = null,
  details: List<A2uiErrorDetail> = emptyList(),
) : A2uiValidationError(message, cause, details)

/** Raised when component graphs or nested function calls exceed maximum recursion depth. */
open class A2uiRecursionError(
  message: String,
  cause: Throwable? = null,
  details: List<A2uiErrorDetail> = emptyList(),
) : A2uiValidationError(message, cause, details)

/** Raised when a remote function call fails, times out, is cancelled, or lacks a listener. */
class A2uiRpcError(
  message: String,
  val code: RpcErrorCode = RpcErrorCode.EXECUTION_ERROR,
  cause: Throwable? = null,
) : A2uiError(message, cause)

/** Raised when a JSON Pointer read or write encounters an invalid path or primitive parent. */
class A2uiDataError(message: String, cause: Throwable? = null) : A2uiError(message, cause)

/** Raised when a surface or component state container is asked for an illegal state transition. */
class A2uiStateError(message: String, cause: Throwable? = null) : A2uiError(message, cause)

/** Raised when raw LLM output or expression syntax cannot be tokenized or parsed. */
open class A2uiParseError(message: String, cause: Throwable? = null) : A2uiError(message, cause)

/** Raised when a bound dynamic expression or regex guard fails during evaluation. */
class A2uiExpressionError(message: String, cause: Throwable? = null) : A2uiError(message, cause)
