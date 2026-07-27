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

package com.google.a2ui.samples.rizzcharts

import com.google.a2ui.a2a.A2aHandler
import com.google.a2ui.basic_catalog.BasicCatalog
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.CatalogConfig
import com.google.adk.agents.ReadonlyContext
import com.google.adk.models.Gemini
import com.google.adk.runner.InMemoryRunner
import com.google.adk.runner.Runner
import io.ktor.http.HttpMethod
import io.ktor.serialization.jackson.jackson
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import java.util.Collections
import kotlin.system.exitProcess

lateinit var schemaManager: A2uiSchemaManager
lateinit var agent: RizzchartsAgent
lateinit var runner: Runner
lateinit var agentExecutor: RizzchartsAgentExecutor
lateinit var a2aHandler: A2aHandler

fun main(args: Array<String>) {
  val dotenv = io.github.cdimascio.dotenv.Dotenv.configure().ignoreIfMissing().load()
  val apiKey = dotenv["GEMINI_API_KEY"] ?: System.getenv("GEMINI_API_KEY")
  val useVertexAi =
    dotenv["GOOGLE_GENAI_USE_VERTEXAI"] ?: System.getenv("GOOGLE_GENAI_USE_VERTEXAI")

  if (useVertexAi != "TRUE" && apiKey.isNullOrEmpty()) {
    System.err.println(
      "Error: GEMINI_API_KEY environment variable not set and GOOGLE_GENAI_USE_VERTEXAI is not TRUE."
    )
    exitProcess(1)
  }

  val envModel = dotenv["LITELLM_MODEL"] ?: System.getenv("LITELLM_MODEL")
  val liteLlmModel = envModel?.takeUnless { it.isEmpty() } ?: "gemini-2.5-flash"

  val host = "localhost"
  val port = 10002
  val baseUrl = "http://$host:$port"

  println("Starting Kotlin Rizzcharts Server (Ktor)...")

  schemaManager =
    A2uiSchemaManager(
      A2uiVersion.VERSION_0_8,
      listOf(
        CatalogConfig.fromPath(
          "rizzcharts",
          "../catalog_schemas/0.8/rizzcharts_catalog_definition.json",
          "../examples/rizzcharts_catalog/0.8",
        ),
        BasicCatalog.getConfig(A2uiVersion.VERSION_0_8, "../examples/standard_catalog/0.8"),
      ),
      true,
      Collections.emptyList(),
    )

  agent =
    RizzchartsAgent(
      baseUrl,
      Gemini(liteLlmModel, apiKey),
      schemaManager,
      { ctx: ReadonlyContext ->
        val isEnabled =
          ctx.state().getOrDefault(RizzchartsAgentExecutor.A2UI_ENABLED_KEY, false) as Boolean
        println("A2UI: Evaluating a2uiEnabled. isEnabled: $isEnabled, ctx.state(): " + ctx.state())
        isEnabled
      },
      { ctx: ReadonlyContext ->
        ctx.state()[RizzchartsAgentExecutor.A2UI_CATALOG_KEY]
          as A2uiCatalog
      },
      { ctx: ReadonlyContext -> ctx.state()[RizzchartsAgentExecutor.A2UI_EXAMPLES_KEY] as String },
    )

  runner = InMemoryRunner(agent)
  agentExecutor = RizzchartsAgentExecutor(baseUrl, schemaManager)
  a2aHandler = A2aHandler(runner)

  embeddedServer(Netty, port = port, host = host) {
      install(CORS) {
        anyHost()
        allowMethod(HttpMethod.Options)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Patch)
        allowHeader("Content-Type")
        allowHeader("Authorization")
        allowCredentials = true
      }
      install(ContentNegotiation) { jackson() }
      routing {
        get("/.well-known/agent-card.json") {
          val response =
            a2aHandler.handleAgentCardGet(
              runner.appName(),
              "http://localhost:10002",
              listOf(
                "https://a2ui.org/specification/v0_8/standard_catalog_definition.json",
                "https://raw.githubusercontent.com/a2ui-project/a2ui/main/samples/agent/adk/rizzcharts/rizzcharts_catalog_definition.json",
              ),
            )
          call.respond(response)
        }

        post("/") {
          val requestBody = call.receive<Map<String, Any>>()
          val response = a2aHandler.handleA2aPost(requestBody, agentExecutor::prepareSession)
          call.respond(response)
        }
      }
    }
    .start(wait = true)
}
