/*
 * Copyright 2024 Google LLC
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

package com.google.a2ui.express

import com.google.a2ui.basic_catalog.BasicCatalog
import com.google.a2ui.inference_formats.experimental.express.ExpressFormat
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiVersion
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject

class ExpressLiveDemoTest {

  private val catalog: A2uiCatalog by lazy {
    val config = BasicCatalog.getConfig(A2uiVersion.VERSION_1_0)
    val manager = A2uiSchemaManager(version = A2uiVersion.VERSION_1_0, catalogs = listOf(config))
    manager.getSelectedCatalog()
  }

  @Test
  fun runLiveDemo() {
    val outputFile = Files.createTempFile("express_live_demo_output", ".txt").toFile()
    outputFile.deleteOnExit()
    val sb = StringBuilder()

    sb.appendLine(
      "================================================================================"
    )
    sb.appendLine(
      "                     A2UI Express Format Live Demonstration                     "
    )
    sb.appendLine(
      "================================================================================"
    )
    sb.appendLine()

    // 1. Initialize format for v1.0 compliant target
    val format = ExpressFormat(catalog = catalog, surfaceId = "main_surface")

    // 2. Generate Prompt Contract
    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    sb.appendLine("1. GENERATED SYSTEM PROMPT CONTRACT")
    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    val prompt =
      format.promptGenerator.generate(
        roleDescription = "You are a customer service assistant capable of rendering UI.",
        includeSchema = true,
      )
    sb.appendLine(prompt)
    sb.appendLine()

    // 3. Compile Express DSL Response into A2UI v1.0 JSON Envelope
    val expressResponse =
      """
      Here is your requested registration form:
      <a2ui>
      root = Column([title, nameInput, emailInput, submitBtn])
      title = Text("Customer Registration")
      nameInput = TextField("Full Name", $/user/name, "shortText", ?required)
      emailInput = TextField("Email Address", $/user/email, "shortText", ?required)
      submitBtn = Button(Text("Submit Registration"), action=Event("save_customer", {name: $/user/name, email: $/user/email}))
      </a2ui>
    """
        .trimIndent()

    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    sb.appendLine("2. RAW LLM RESPONSE CONTAINING A2UI EXPRESS DSL")
    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    sb.appendLine(expressResponse)
    sb.appendLine()

    val responseParts = format.parser.parseResponse(expressResponse)
    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    sb.appendLine("3. PARSED RESPONSE PARTS (TEXT + COMPILED A2UI JSON)")
    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    for ((idx, part) in responseParts.withIndex()) {
      sb.appendLine("Part #$idx:")
      if (part.a2uiRaw != null) {
        sb.appendLine("  [A2UI Raw DSL]:\n${part.a2uiRaw}")
        sb.appendLine("  [Compiled A2UI JSON Envelope]:")
        sb.appendLine(part.a2uiJson.toString())
      } else {
        sb.appendLine("  [Conversational Text]: ${part.text}")
      }
    }
    sb.appendLine()

    // 4. Decompile compiled JSON envelope back to Express DSL
    val expressPart = responseParts.first { it.a2uiJson != null }
    val compiledEnvelope = expressPart.a2uiJson!![0] as JsonObject
    val decompiledDsl = format.parser.decompile(compiledEnvelope)

    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    sb.appendLine("4. DECOMPILED EXPRESS DSL FROM JSON ENVELOPE")
    sb.appendLine(
      "--------------------------------------------------------------------------------"
    )
    sb.appendLine(decompiledDsl)
    sb.appendLine()

    sb.appendLine(
      "================================================================================"
    )
    sb.appendLine(
      "                              DEMO COMPLETE SUCCESS                             "
    )
    sb.appendLine(
      "================================================================================"
    )

    outputFile.writeText(sb.toString())
    assertTrue(decompiledDsl.contains("Submit Registration"))
  }
}
