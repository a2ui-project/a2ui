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

package com.google.a2ui.agent.parser

import com.google.a2ui.core.exceptions.A2uiError
import com.google.a2ui.core.exceptions.A2uiErrorDetail
import com.google.a2ui.core.exceptions.A2uiParseError
import com.google.a2ui.core.exceptions.A2uiValidationError

/**
 * Marker contract implemented by all inference-format compilation errors (`a2ui_agent.blueprint.md`
 * §3.C).
 *
 * Because JVM `catch` clauses require a `Throwable` subclass rather than an interface, callers
 * catch [A2uiError] and check `e is A2uiCompilationError`.
 */
interface A2uiCompilationError {
  val message: String
  val rawBlock: String?
}

/** General inference-format compilation failure not narrowed to syntax or schema validation. */
open class A2uiCompilationException(
  override val message: String,
  override val rawBlock: String? = null,
  code: String = "compilation_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) :
  A2uiError(message = message, cause = cause, details = details, code = code, path = path),
  A2uiCompilationError

/** Syntactic parse failure raised while compiling an inference-format block. */
open class A2uiCompilationParseError(
  message: String,
  override val rawBlock: String? = null,
  code: String = "compilation_parse_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) :
  A2uiParseError(message = message, cause = cause, details = details, code = code, path = path),
  A2uiCompilationError

/** Semantic or schema validation failure raised while compiling an inference-format block. */
open class A2uiCompilationValidationError(
  message: String,
  override val rawBlock: String? = null,
  code: String = "compilation_validation_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) :
  A2uiValidationError(
    message = message,
    cause = cause,
    details = details,
    code = code,
    path = path,
  ),
  A2uiCompilationError
