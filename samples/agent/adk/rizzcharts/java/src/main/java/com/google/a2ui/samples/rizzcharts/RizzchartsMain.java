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

package com.google.a2ui.samples.rizzcharts;

import com.google.a2ui.a2a.A2aHandler;
import com.google.a2ui.basic_catalog.BasicCatalog;
import com.google.a2ui.schema.A2uiCatalog;
import com.google.a2ui.schema.A2uiSchemaManager;
import com.google.a2ui.schema.A2uiVersion;
import com.google.a2ui.schema.CatalogConfig;
import com.google.adk.runner.InMemoryRunner;
import com.google.adk.runner.Runner;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.NonNull;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@SpringBootApplication
@RestController
public class RizzchartsMain {

  private static A2uiSchemaManager schemaManager;
  private static Runner runner;
  private static RizzchartsAgentExecutor agentExecutor;
  private static A2aHandler a2aHandler;

  @Bean
  public WebMvcConfigurer corsConfigurer() {
    return new WebMvcConfigurer() {
      @Override
      public void addCorsMappings(@NonNull CorsRegistry registry) {
        registry
            .addMapping("/**")
            .allowedOrigins("http://localhost:5173")
            .allowedMethods("*")
            .allowedHeaders("*")
            .allowCredentials(true);
      }
    };
  }

  @GetMapping(value = "/.well-known/agent-card.json", produces = MediaType.APPLICATION_JSON_VALUE)
  public Map<String, Object> handleAgentCardGet() {
    return a2aHandler.handleAgentCardGet(
        runner.appName(),
        "http://localhost:10002",
        List.of(
            "https://a2ui.org/specification/v0_8/standard_catalog_definition.json",
            "https://github.com/a2ui-project/a2ui/blob/main/samples/agent/adk/rizzcharts/rizzcharts_catalog_definition.json"));
  }

  @PostMapping(value = "/", produces = MediaType.APPLICATION_JSON_VALUE)
  public Map<String, Object> handleA2ARequest(@RequestBody Map<String, Object> requestBody) {
    return a2aHandler.handleA2aPost(
        requestBody,
        (session, rpcContext) -> {
          Object paramsObj = rpcContext.get("params");
          Map<?, ?> params = paramsObj instanceof Map ? (Map<?, ?>) paramsObj : null;

          Object messageObj = params != null ? params.get("message") : null;
          Map<?, ?> messageMap = messageObj instanceof Map ? (Map<?, ?>) messageObj : null;

          Object metadataObj = messageMap != null ? messageMap.get("metadata") : null;
          Map<?, ?> metadata = metadataObj instanceof Map ? (Map<?, ?>) metadataObj : null;

          boolean useUi = metadata != null && metadata.containsKey("a2uiClientCapabilities");

          session.state().put("base_url", "http://localhost:10002");
          session.state().put(RizzchartsAgentExecutor.A2UI_ENABLED_KEY, useUi);

          if (useUi) {
            session
                .state()
                .put(RizzchartsAgentExecutor.A2UI_CATALOG_KEY, schemaManager.getSelectedCatalog());
            try {
              session
                  .state()
                  .put(
                      RizzchartsAgentExecutor.A2UI_EXAMPLES_KEY,
                      schemaManager.loadExamples(schemaManager.getSelectedCatalog()));
            } catch (Exception e) {
              // Ignore loading error
            }
          } else {
            session.state().remove(RizzchartsAgentExecutor.A2UI_CATALOG_KEY);
            session.state().remove(RizzchartsAgentExecutor.A2UI_EXAMPLES_KEY);
          }
          return kotlin.Unit.INSTANCE;
        });
  }

  public static void main(String[] args) throws IOException {
    io.github.cdimascio.dotenv.Dotenv dotenv =
        io.github.cdimascio.dotenv.Dotenv.configure().ignoreIfMissing().load();

    String apiKey = dotenv.get("GEMINI_API_KEY");
    if (apiKey == null || apiKey.isEmpty()) apiKey = System.getenv("GEMINI_API_KEY");

    String useVertexAi = dotenv.get("GOOGLE_GENAI_USE_VERTEXAI");
    if (useVertexAi == null || useVertexAi.isEmpty())
      useVertexAi = System.getenv("GOOGLE_GENAI_USE_VERTEXAI");

    if (!"TRUE".equals(useVertexAi) && (apiKey == null || apiKey.isEmpty())) {
      System.err.println(
          "Error: GEMINI_API_KEY environment variable not set and GOOGLE_GENAI_USE_VERTEXAI is not TRUE.");
      System.exit(1);
    }

    String liteLlmModel = dotenv.get("LITELLM_MODEL");
    if (liteLlmModel == null || liteLlmModel.isEmpty())
      liteLlmModel = System.getenv("LITELLM_MODEL");
    if (liteLlmModel == null || liteLlmModel.isEmpty()) {
      liteLlmModel = "gemini-2.5-flash";
    }

    String host = "localhost";
    int port = 10002;
    String baseUrl = "http://" + host + ":" + port;

    System.out.println("Starting Java Rizzcharts Server...");

    schemaManager =
        new A2uiSchemaManager(
            A2uiVersion.VERSION_0_8,
            List.of(
                CatalogConfig.fromPath(
                    "rizzcharts",
                    "../catalog_schemas/0.8/rizzcharts_catalog_definition.json",
                    "../examples/rizzcharts_catalog/0.8"),
                BasicCatalog.getConfig(
                    A2uiVersion.VERSION_0_8, "../examples/standard_catalog/0.8")),
            true,
            List.of());

    RizzchartsAgent agent =
        new RizzchartsAgent(
            baseUrl,
            new com.google.adk.models.Gemini(liteLlmModel, apiKey),
            schemaManager,
            ctx -> {
              return (Boolean)
                  ctx.state().getOrDefault(RizzchartsAgentExecutor.A2UI_ENABLED_KEY, false);
            },
            ctx -> {
              return (A2uiCatalog)
                  ctx.state().get(RizzchartsAgentExecutor.A2UI_CATALOG_KEY);
            },
            ctx -> {
              return (String) ctx.state().get(RizzchartsAgentExecutor.A2UI_EXAMPLES_KEY);
            });

    runner = new InMemoryRunner(agent);
    a2aHandler = new A2aHandler(runner);

    // RizzchartsAgentExecutor was previously relying on io.a2a.agent executor classes.
    // We will keep it around but mostly bypass its A2A implementation since A2A is missing.
    // agentExecutor = new RizzchartsAgentExecutor(baseUrl, runner, schemaManager);

    SpringApplication.run(RizzchartsMain.class, args);
    System.out.println("Server started on port " + port);
  }
}
