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

package com.google.a2ui.core

/** Structured diagnostic detail attached to an [A2uiError]. */
data class A2uiErrorDetail(val code: String, val message: String, val path: String? = null)

/** Base exception for all A2UI protocol, catalog, parsing, and validation failures. */
open class A2uiError(
  val code: String,
  override val message: String,
  val path: String? = null,
  val details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) : RuntimeException(message, cause)

/** Thrown when input text or JSON fails syntactic parsing. */
open class A2uiParseError(
  message: String,
  code: String = "parse_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) : A2uiError(code = code, message = message, path = path, details = details, cause = cause)

/** Thrown when parsed messages or components violate protocol or catalog constraints. */
open class A2uiValidationError(
  message: String,
  code: String = "validation_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) : A2uiError(code = code, message = message, path = path, details = details, cause = cause)

/** Thrown when surface component topology or referential integrity is violated. */
open class A2uiIntegrityError(
  message: String,
  code: String = "integrity_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) :
  A2uiValidationError(
    code = code,
    message = message,
    path = path,
    details = details,
    cause = cause,
  )

/** Thrown when nesting depth or cycle recursion limits are exceeded. */
open class A2uiRecursionError(
  message: String,
  code: String = "recursion_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) :
  A2uiValidationError(
    code = code,
    message = message,
    path = path,
    details = details,
    cause = cause,
  )

/** Thrown when a catalog schema or catalog list configuration is invalid or unsupported. */
open class A2uiCatalogError(
  message: String,
  code: String = "catalog_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) : A2uiError(code = code, message = message, path = path, details = details, cause = cause)
