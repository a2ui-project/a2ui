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
import com.google.a2ui.core.AgentToRendererMessage

/** Base sealed type emitted by incremental [ResponseStream] parsing. */
sealed interface StreamPart

/** Validated output part produced by [Parser.parseResponse] or [ResponseStream]. */
sealed interface ResponsePart : StreamPart

/** Uncompiled part produced by [Parser.unwrap] before compilation. */
data class RawResponsePart(val part: RawPartContent, val isFinal: Boolean = true)

/** Marker interface for content inside a [RawResponsePart] ([TextPart] or [RawA2uiPart]). */
sealed interface RawPartContent

/** Conversational markdown/plain text outside `<a2ui>` blocks. */
data class TextPart(val text: String) : ResponsePart, RawPartContent

/** Raw uncompiled `<a2ui>...</a2ui>` inner block text. */
data class RawA2uiPart(val a2uiRaw: String) : RawPartContent

/** Compiled and state-validated A2UI wire messages emitted from an `<a2ui>` block. */
data class A2uiPart(val a2ui: List<AgentToRendererMessage>) : ResponsePart

/**
 * Emitted in place of a rejected `<a2ui>` block when streaming with [AfterRejectedBlock.CONTINUE].
 */
data class ErrorPart(val error: A2uiError) : StreamPart
