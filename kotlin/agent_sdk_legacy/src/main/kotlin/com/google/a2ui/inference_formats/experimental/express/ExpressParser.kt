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

import com.google.a2ui.parser.BlockLexer
import com.google.a2ui.parser.Parser
import com.google.a2ui.parser.ResponsePart
import com.google.a2ui.parser.errors.A2uiCompilationError
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Concrete parser implementation for A2UI Express DSL responses. */
class ExpressParser(
  val catalog: A2uiCatalog,
  val surfaceId: String = "main",
  val version: String = "v1.0",
) : Parser {

  override fun hasFormatContent(content: String, complete: Boolean): Boolean {
    if (complete) {
      return content.contains(A2uiConstants.A2UI_INFERENCE_OPEN_TAG) &&
        content.contains(A2uiConstants.A2UI_INFERENCE_CLOSE_TAG)
    }
    return content.contains(A2uiConstants.A2UI_INFERENCE_OPEN_TAG.dropLast(1))
  }

  override fun unwrap(content: String): List<ResponsePart> {
    val lexer =
      BlockLexer(
        openTag = A2uiConstants.A2UI_INFERENCE_OPEN_TAG,
        closeTag = A2uiConstants.A2UI_INFERENCE_CLOSE_TAG,
      )
    return lexer.tokenize(content)
  }

  override fun compile(formatContent: String, isFinal: Boolean): List<JsonElement> {
    val compiler = ExpressCompiler(catalog, version = version)
    return try {
      val compiledJson = compiler.compile(formatContent, surfaceId = surfaceId, isFinal = isFinal)
      if (compiledJson is kotlinx.serialization.json.JsonArray) {
        compiledJson.toList()
      } else {
        listOf(compiledJson)
      }
    } catch (e: Exception) {
      throw A2uiCompilationError(
        message = e.message ?: "Failed to compile Express DSL",
        rawContent = formatContent,
        helpMessage = "Please correct the syntax error in your Express DSL.",
        cause = e,
      )
    }
  }

  override fun decompile(valElement: JsonObject): String {
    return ExpressDecompiler(catalog).decompile(valElement)
  }

  override fun wrapDecompiledBlocks(blocks: List<String>): String {
    return ExpressDecompiler(catalog).wrapDecompiledBlocks(blocks)
  }
}
