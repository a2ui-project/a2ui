/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.a2ui.exceptions

import java.lang.IllegalArgumentException

/** Base exception class for all A2UI SDK failures. */
open class A2uiException(message: String, cause: Throwable? = null) : IllegalArgumentException(message, cause)

/** Exception raised when failing to parse or extract A2UI payloads. */
class A2uiParseException(message: String, cause: Throwable? = null) : A2uiException(message, cause)

/** Exception raised when A2UI payload violates schema constraints. */
class A2uiValidationException(message: String, cause: Throwable? = null) : A2uiException(message, cause)

/** Exception raised during catalog management or loading. */
class A2uiCatalogException(message: String, cause: Throwable? = null) : A2uiException(message, cause)

/** Exception raised when layout graph integrity or relationship checks fail. */
class A2uiIntegrityException(message: String, cause: Throwable? = null) : A2uiException(message, cause)

/** Exception raised when recursive or traversal limits are exceeded. */
class A2uiRecursionException(message: String, cause: Throwable? = null) : A2uiException(message, cause)

/** Exception raised when compiling or translating alternative UI formats/DSLs. */
class A2uiCompileException(message: String, cause: Throwable? = null) : A2uiException(message, cause)
