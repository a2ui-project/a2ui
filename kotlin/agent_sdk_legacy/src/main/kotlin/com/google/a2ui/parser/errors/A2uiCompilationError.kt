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

package com.google.a2ui.parser.errors

import com.google.a2ui.exceptions.A2uiException
import com.google.a2ui.parser.ResponsePart

/** Exception raised when raw format content fails to compile into valid A2UI JSON payloads. */
class A2uiCompilationError(
  message: String,
  val rawContent: String? = null,
  val line: Int? = null,
  val column: Int? = null,
  val helpMessage: String? = null,
  var partialResults: List<ResponsePart> = emptyList(),
  cause: Throwable? = null,
) : A2uiException(message, cause)
