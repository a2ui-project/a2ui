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

package com.google.a2ui.inference_formats.experimental.express

import com.google.a2ui.parser.errors.A2uiCompilationError

/** Base exception for Express DSL compilation failures. */
open class ExpressCompilerError(
  val rawMessage: String,
  line: Int? = null,
  column: Int? = null,
  val hint: String? = null,
  rawContent: String? = null,
  cause: Throwable? = null,
) :
  A2uiCompilationError(
    message = formatExpressError(rawMessage, line, column, hint),
    rawContent = rawContent,
    line = line,
    column = column,
    helpMessage = hint,
    cause = cause,
  )

/** Syntax or grammar error encountered while parsing Express source. */
class ExpressParseError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
  cause: Throwable? = null,
) : ExpressCompilerError(message, line, column, hint, cause = cause)

/** Base semantic or schema validation error during Express compilation. */
open class ExpressValidationError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
  cause: Throwable? = null,
) : ExpressCompilerError(message, line, column, hint, cause = cause)

class ExpressIdCollisionError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
) : ExpressValidationError(message, line, column, hint)

class ExpressCycleError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
) : ExpressValidationError(message, line, column, hint)

class ExpressUnknownTypeError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
) : ExpressValidationError(message, line, column, hint)

class ExpressUnknownPropertyError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
) : ExpressValidationError(message, line, column, hint)

class ExpressCheckError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
) : ExpressValidationError(message, line, column, hint)

class ExpressDataBindingError(
  message: String,
  line: Int? = null,
  column: Int? = null,
  hint: String? = null,
) : ExpressValidationError(message, line, column, hint)

private fun formatExpressError(message: String, line: Int?, column: Int?, hint: String?): String {
  val loc =
    when {
      line != null && column != null -> " at line $line, column $column"
      line != null -> " at line $line"
      else -> ""
    }
  val hintSuffix = if (!hint.isNullOrEmpty()) "\n  Hint: $hint" else ""
  return "[Express Compiler Error]$loc: $message$hintSuffix"
}
