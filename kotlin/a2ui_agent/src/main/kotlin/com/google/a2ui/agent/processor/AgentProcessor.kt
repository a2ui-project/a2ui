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

package com.google.a2ui.agent.processor

import com.google.a2ui.agent.InferenceFormat
import com.google.a2ui.agent.InferenceFormatFactory
import com.google.a2ui.agent.catalogtransformers.CatalogTransformer
import com.google.a2ui.agent.parser.A2uiPart
import com.google.a2ui.agent.parser.AfterRejectedBlock
import com.google.a2ui.agent.parser.ErrorPart
import com.google.a2ui.agent.parser.Parser
import com.google.a2ui.agent.parser.ResponsePart
import com.google.a2ui.agent.parser.ResponseStream
import com.google.a2ui.agent.parser.StreamPart
import com.google.a2ui.agent.parser.TextPart
import com.google.a2ui.agent.utils.RendererState
import com.google.a2ui.agent.utils.resolveCatalogs
import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.catalog.ComponentApi
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.processing.MessageProcessor
import com.google.a2ui.core.schema.A2uiRendererCapabilities
import com.google.a2ui.core.schema.AgentToRendererMessage
import com.google.a2ui.core.state.SurfaceModel
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** Loads a [CatalogApi] definition (`a2ui_agent.blueprint.md` §3.F `CatalogProvider`). */
fun interface CatalogProvider {
  fun load(): CatalogApi
}

class FileSystemCatalogProvider(
  val path: Path,
  val protocolVersion: ProtocolVersion? = null,
  val catalogId: String? = null,
) : CatalogProvider {
  constructor(
    path: String,
    protocolVersion: ProtocolVersion? = null,
    catalogId: String? = null,
  ) : this(Path.of(path), protocolVersion, catalogId)

  override fun load(): CatalogApi {
    if (!Files.isRegularFile(path)) {
      throw A2uiCatalogError("Catalog file does not exist: '$path'")
    }
    val rawText =
      try {
        Files.readString(path)
      } catch (e: Exception) {
        throw A2uiCatalogError("Failed to read catalog file '$path': ${e.message}", e)
      }
    val parsed =
      try {
        Json.parseToJsonElement(rawText)
      } catch (e: Exception) {
        throw A2uiCatalogError("Catalog file '$path' is not valid JSON: ${e.message}", e)
      }
    val obj =
      parsed as? JsonObject ?: throw A2uiCatalogError("Catalog document '$path' must be an object")
    return Catalog.fromJson(obj, expectedVersion = protocolVersion, expectedCatalogId = catalogId)
  }
}

class InMemoryCatalogProvider(
  val catalog: JsonObject,
  val protocolVersion: ProtocolVersion? = null,
  val catalogId: String? = null,
) : CatalogProvider {
  override fun load(): CatalogApi =
    Catalog.fromJson(catalog, expectedVersion = protocolVersion, expectedCatalogId = catalogId)
}

/**
 * Associates a resolved [CatalogApi] with sequential [CatalogTransformer] rules (`blueprint` §3.F).
 */
data class CatalogConfig(
  val catalog: CatalogApi,
  val transformers: List<CatalogTransformer> = emptyList(),
) {
  val transformedCatalog: CatalogApi by lazy {
    transformers.fold(catalog) { acc, transformer -> transformer.transform(acc) }
  }

  companion object {
    fun fromPath(
      catalogPath: String,
      transformers: List<CatalogTransformer> = emptyList(),
      protocolVersion: ProtocolVersion? = null,
      catalogId: String? = null,
    ): CatalogConfig =
      CatalogConfig(
        catalog =
          FileSystemCatalogProvider(
              path = catalogPath,
              protocolVersion = protocolVersion,
              catalogId = catalogId,
            )
            .load(),
        transformers = transformers,
      )
  }
}

/**
 * Request-scoped facade unifying active catalogs, prompt snippet, parsing, and validation
 * (`a2ui_agent.blueprint.md` §3.F `A2uiRequestProcessor`).
 */
class A2uiRequestProcessor(
  catalogs: List<CatalogApi>,
  val examples: List<List<AgentToRendererMessage>>? = null,
  formatFactory: InferenceFormatFactory,
) {
  val activeCatalogs: List<CatalogApi> = catalogs.toList()
  val format: InferenceFormat = formatFactory.createFormat(this.activeCatalogs, examples)

  init {
    if (this.activeCatalogs.isEmpty()) {
      throw A2uiCatalogError("A2uiRequestProcessor requires at least one active catalog")
    }
    if (examples != null) {
      val validatorState = RendererState(this.activeCatalogs)
      for (turn in examples) {
        val touched = validatorState.apply(turn)
        validatorState.checkTopology(touched)
        validatorState.reset()
      }
    }
  }

  val promptSnippet: String
    get() = format.promptGenerator.generate()

  fun createParser(): Parser = format.createParser()

  fun parseResponse(content: String, state: RendererState? = null): List<ResponsePart> =
    createParser()
      .parseResponse(content, wrapped = true, state = state ?: RendererState(activeCatalogs))

  fun openStream(
    wrapped: Boolean = true,
    state: RendererState? = null,
  ): ResponseStream<ResponsePart> =
    createParser().openStream(wrapped = wrapped, state = state ?: RendererState(activeCatalogs))

  fun openStreamContinuing(
    wrapped: Boolean = true,
    state: RendererState? = null,
  ): ResponseStream<StreamPart> =
    createParser()
      .openStreamContinuing(wrapped = wrapped, state = state ?: RendererState(activeCatalogs))

  fun openStream(
    wrapped: Boolean = true,
    state: RendererState? = null,
    afterRejectedBlock: AfterRejectedBlock,
  ): ResponseStream<StreamPart> =
    createParser()
      .openStream(
        wrapped = wrapped,
        state = state ?: RendererState(activeCatalogs),
        afterRejectedBlock = afterRejectedBlock,
      )
}

/**
 * Agent-lifetime factory negotiating per-request [A2uiRequestProcessor] instances
 * (`a2ui_agent.blueprint.md` §3.F `A2uiGenerator`).
 */
class A2uiGenerator(
  val catalogs: List<CatalogConfig>,
  val examples: List<List<AgentToRendererMessage>>? = null,
  val inferenceFormatFactory: InferenceFormatFactory,
  val acceptsInlineCatalogs: Boolean = false,
) {
  fun createProcessor(
    rendererCapabilities: A2uiRendererCapabilities,
    overrideFormatFactory: InferenceFormatFactory? = null,
  ): A2uiRequestProcessor {
    val negotiated =
      resolveCatalogs(
        catalogs = catalogs,
        rendererCapabilities = rendererCapabilities,
        acceptsInlineCatalogs = acceptsInlineCatalogs,
      )
    return A2uiRequestProcessor(
      catalogs = negotiated,
      examples = examples,
      formatFactory = overrideFormatFactory ?: inferenceFormatFactory,
    )
  }
}

/** Answer parts for combined agent+renderer apps (`agent_renderer_app.blueprint.md` §3). */
sealed interface AnswerPart

data class AnswerTextPart(val text: String) : AnswerPart

data class AnswerSurfacePart(val surface: SurfaceModel<ComponentApi>) : AnswerPart

data class AnswerErrorPart(val errorPart: ErrorPart) : AnswerPart

/**
 * Streams one LLM answer directly onto a live renderer [MessageProcessor] (`agent_renderer_app`).
 */
class StreamedAnswer(
  processor: A2uiRequestProcessor,
  val renderer: MessageProcessor<ComponentApi>,
) {
  private val stream: ResponseStream<StreamPart>
  private val orderedEntries = mutableListOf<Any>()

  init {
    val rendererIds = renderer.catalogs.map { it.id }
    val activeIds = processor.activeCatalogs.map { it.id }
    if (rendererIds != activeIds) {
      throw A2uiCatalogError(
        "Renderer catalogs $rendererIds do not match processor active catalogs $activeIds"
      )
    }
    stream = processor.openStreamContinuing(wrapped = true, state = RendererState.of(renderer))
  }

  val isInBlock: Boolean
    get() = stream.isInBlock

  val parts: List<AnswerPart>
    get() =
      orderedEntries.mapNotNull { item ->
        when (item) {
          is AnswerTextPart -> item
          is AnswerErrorPart -> item
          is String -> renderer.model.getSurface(item)?.let { AnswerSurfacePart(it) }
          else -> null
        }
      }

  fun feed(chunk: String) {
    record(stream.feed(chunk))
  }

  fun close() {
    record(stream.close())
  }

  private fun record(emitted: List<StreamPart>) {
    for (part in emitted) {
      when (part) {
        is TextPart -> {
          val lastIdx = orderedEntries.lastIndex
          if (lastIdx >= 0 && orderedEntries[lastIdx] is AnswerTextPart) {
            val prev = orderedEntries[lastIdx] as AnswerTextPart
            orderedEntries[lastIdx] = AnswerTextPart(prev.text + part.text)
          } else {
            orderedEntries.add(AnswerTextPart(part.text))
          }
        }
        is A2uiPart -> {
          for (id in renderer.model.surfaces.keys) {
            if (!orderedEntries.contains(id)) {
              orderedEntries.add(id)
            }
          }
        }
        is ErrorPart -> orderedEntries.add(AnswerErrorPart(part))
      }
    }
  }
}
