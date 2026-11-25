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
import com.google.a2ui.core.schema.AgentToRendererMessage

/**
 * Sealed response part unions (`a2ui_agent.blueprint.md` §3.C).
 *
 * Using Kotlin `sealed interface` multi-inheritance allows [TextPart] and [A2uiPart] to belong
 * simultaneously to [ResponsePart] (non-failing streams and one-shot parses) and [StreamPart]
 * (continuing streams that may also emit [ErrorPart]), giving callers exhaustive `when` checks
 * without forcing `ErrorPart` branches onto callers of `openStream()`.
 */
sealed interface RawPartContent

sealed interface ResponsePart : StreamPart

sealed interface StreamPart

/** Conversational prose extracted outside A2UI sentinel blocks. */
data class TextPart(val text: String) : RawPartContent, ResponsePart

/** Uncompiled format block extracted between sentinel tags (`<a2ui>` or `<a2ui-json>`). */
data class RawA2uiPart(val a2uiRaw: String) : RawPartContent

/** Tokenized raw slice paired with truncation flag (`isFinal`). */
data class RawResponsePart(val part: RawPartContent, val isFinal: Boolean = true)

/** Compiled and validated A2UI protocol messages ready for delivery to a renderer. */
data class A2uiPart(val a2ui: List<AgentToRendererMessage>) : ResponsePart

/** Rejected block emitted only by a continuing stream (`afterRejectedBlock = CONTINUE`). */
data class ErrorPart(val error: A2uiError) : StreamPart
