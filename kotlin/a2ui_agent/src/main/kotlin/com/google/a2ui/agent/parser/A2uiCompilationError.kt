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

import com.google.a2ui.core.exceptions.A2uiErrorDetail
import com.google.a2ui.core.exceptions.A2uiParseError
import com.google.a2ui.core.exceptions.A2uiValidationError

/**
 * Shared contract across parse-phase and validation-phase format compilation failures
 * (`a2ui_agent.blueprint.md` §3.C).
 *
 * Resolves the single-inheritance diamond on the JVM:
 * - [A2uiCompilationParseError] extends [A2uiParseError] AND implements [A2uiCompilationFailure]
 * - [A2uiCompilationValidationError] extends [A2uiValidationError] AND implements
 *   [A2uiCompilationFailure]
 */
interface A2uiCompilationFailure {
  val message: String?
  val rawBlock: String?
  val line: Int?
  val column: Int?
}

open class A2uiCompilationError(
  override val message: String,
  override val rawBlock: String? = null,
  override val line: Int? = null,
  override val column: Int? = null,
  cause: Throwable? = null,
) : A2uiParseError(message, cause), A2uiCompilationFailure

open class A2uiCompilationParseError(
  message: String,
  rawBlock: String? = null,
  line: Int? = null,
  column: Int? = null,
  cause: Throwable? = null,
) : A2uiCompilationError(message, rawBlock, line, column, cause)

open class A2uiCompilationValidationError(
  override val message: String,
  override val rawBlock: String? = null,
  override val line: Int? = null,
  override val column: Int? = null,
  cause: Throwable? = null,
  details: List<A2uiErrorDetail> = emptyList(),
) : A2uiValidationError(message, cause, details), A2uiCompilationFailure
