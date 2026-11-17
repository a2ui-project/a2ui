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

package com.google.a2ui.agent

import com.google.a2ui.core.A2uiError
import com.google.a2ui.core.A2uiErrorDetail
import com.google.a2ui.core.A2uiParseError
import com.google.a2ui.core.A2uiValidationError

/** Marker contract implemented by all inference-format compilation errors. */
interface A2uiCompilationError {
  val message: String
  val rawBlock: String?
}

/** General inference-format compilation failure wrapping an unexpected error. */
open class A2uiCompilationException(
  override val message: String,
  override val rawBlock: String? = null,
  code: String = "compilation_error",
  path: String? = null,
  details: List<A2uiErrorDetail> = emptyList(),
  cause: Throwable? = null,
) :
  A2uiError(code = code, message = message, path = path, details = details, cause = cause),
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
  A2uiParseError(code = code, message = message, path = path, details = details, cause = cause),
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
    code = code,
    message = message,
    path = path,
    details = details,
    cause = cause,
  ),
  A2uiCompilationError
