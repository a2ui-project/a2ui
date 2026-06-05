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

import com.google.a2ui.schema.A2uiSchemaManager;
import com.google.adk.runner.Runner;
import com.google.adk.sessions.Session;

public class RizzchartsAgentExecutor {

  public static final String A2UI_ENABLED_KEY = "a2ui_enabled";
  public static final String A2UI_CATALOG_KEY = "a2ui_catalog";
  public static final String A2UI_EXAMPLES_KEY = "a2ui_examples";

  private final String baseUrl;
  private final Runner runner;
  private final A2uiSchemaManager schemaManager;

  public RizzchartsAgentExecutor(String baseUrl, Runner runner, A2uiSchemaManager schemaManager) {
    this.baseUrl = baseUrl;
    this.runner = runner;
    this.schemaManager = schemaManager;
  }

  // Manual implementation since A2aAgentExecutor is not available
  public Session prepareSession(String sessionId) {
    Session session =
        runner
            .sessionService()
            .getSession(sessionId, "default_user", "default_app", java.util.Optional.empty())
            .blockingGet();

    // Pre-configure the session state with A2UI components
    boolean useUi = true; // In full A2A, this checks for A2A capabilities headers.

    if (!session.state().containsKey("base_url")) {
      session.state().put("base_url", baseUrl);
    }

    if (!session.state().containsKey(A2UI_ENABLED_KEY)) {
      session.state().put(A2UI_ENABLED_KEY, useUi);
    }

    if (!session.state().containsKey(A2UI_CATALOG_KEY)) {
      if (useUi) {
        session.state().put(A2UI_CATALOG_KEY, schemaManager.getSelectedCatalog());
      } else {
        session.state().put(A2UI_CATALOG_KEY, null);
      }
    }

    if (!session.state().containsKey(A2UI_EXAMPLES_KEY)) {
      if (useUi) {
        session
            .state()
            .put(A2UI_EXAMPLES_KEY, schemaManager.loadExamples(schemaManager.getSelectedCatalog()));
      } else {
        session.state().put(A2UI_EXAMPLES_KEY, null);
      }
    }

    return session;
  }
}
