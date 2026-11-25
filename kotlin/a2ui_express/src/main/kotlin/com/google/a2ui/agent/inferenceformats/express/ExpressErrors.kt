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

package com.google.a2ui.agent.inferenceformats.express

import com.google.a2ui.agent.parser.A2uiCompilationParseError
import com.google.a2ui.agent.parser.A2uiCompilationValidationError

/** Syntactic parse error in A2UI Express DSL source text. */
open class ExpressParseError(message: String, rawBlock: String? = null, cause: Throwable? = null) :
  A2uiCompilationParseError(message = message, rawBlock = rawBlock, cause = cause)

/** Semantic or schema validation error raised during A2UI Express compilation or decompilation. */
open class ExpressValidationError(
  message: String,
  rawBlock: String? = null,
  cause: Throwable? = null,
) : A2uiCompilationValidationError(message = message, rawBlock = rawBlock, cause = cause)

/** Raised when a surface creation scope omits its required `root` component. */
class ExpressUndefinedRootError(rootName: String = "root") :
  ExpressParseError("Root target '$rootName' is not defined.")

/** Raised when a component call passes a keyword property not declared in the catalog. */
class ExpressUnknownPropertyError(
  componentName: String,
  propertyName: String,
  allowedProperties: List<String>,
) :
  ExpressValidationError(
    "Unknown property '$propertyName' on component '$componentName'. Allowed properties: $allowedProperties."
  )

/** Raised when a component property is passed both positionally and by keyword (or twice). */
class ExpressDuplicatePropertyError(componentName: String, propertyName: String) :
  ExpressValidationError(
    "Duplicate property '$propertyName' passed to component '$componentName'."
  )

/** Raised when a function call passes a keyword parameter not declared by the function. */
class ExpressInvalidParamError(
  functionName: String,
  paramName: String,
  allowedParams: List<String>,
) :
  ExpressValidationError(
    "Invalid parameter '$paramName' for function '$functionName'. Allowed parameters: $allowedParams."
  )

/** Raised when a function call parameter is passed both positionally and by keyword (or twice). */
class ExpressDuplicateParamError(functionName: String, paramName: String) :
  ExpressValidationError("Duplicate parameter '$paramName' passed to function '$functionName'.")

/** Raised when a `$path` data binding is passed to a static property that forbids data binding. */
class ExpressForbiddenDatabindingError(componentName: String, propertyName: String) :
  ExpressValidationError(
    "Property '$propertyName' of component '$componentName' does not support dynamic data binding."
  )
