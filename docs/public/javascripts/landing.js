/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function () {
  const state = {
    outPax: 1,
    retPax: 2,
    premium: false,
    bags: true,
    booked: false,
  };

  function updateTravelWidget() {
    const outLabel = document.getElementById("a2-out-pax-label");
    const retLabel = document.getElementById("a2-ret-pax-label");
    const outPriceEl = document.getElementById("a2-out-price");
    const retPriceEl = document.getElementById("a2-ret-price");
    const totalEl = document.getElementById("a2-travel-total");
    const dataModelEl = document.getElementById("a2-datamodel-code");
    const bookBtn = document.getElementById("a2-book-btn");
    const premBtn = document.getElementById("a2-toggle-premium");
    const bagsBtn = document.getElementById("a2-toggle-bags");

    if (!outLabel || !retLabel || !totalEl) return;

    const cabinAdd = state.premium ? 280 : 0;
    const bagAdd = state.bags ? 65 : 0;
    const outUnit = 455 + cabinAdd;
    const retUnit = 498 + cabinAdd;
    const outSum = state.outPax * outUnit;
    const retSum = state.retPax * retUnit;
    const total = outSum + retSum + bagAdd;

    outLabel.textContent =
      state.outPax + (state.outPax === 1 ? " Passenger" : " Passengers");
    retLabel.textContent =
      state.retPax + (state.retPax === 1 ? " Passenger" : " Passengers");
    outPriceEl.textContent = "€" + outSum.toLocaleString();
    retPriceEl.textContent =
      "€" + retSum.toLocaleString() + " (€" + retUnit + " × " + state.retPax + ")";
    totalEl.textContent = "€" + total.toLocaleString();

    if (premBtn) {
      premBtn.classList.toggle("is-active", state.premium);
    }
    if (bagsBtn) {
      bagsBtn.classList.toggle("is-active", state.bags);
    }
    if (bookBtn) {
      if (state.booked) {
        bookBtn.textContent = "✓ Confirmed (actionResponse #A2UI-849)";
        bookBtn.style.background = "#059669";
      } else {
        bookBtn.textContent = "Confirm & Book Trip →";
        bookBtn.style.background = "";
      }
    }
    if (dataModelEl) {
      const cabinStr = state.premium ? "premium" : "economy";
      dataModelEl.textContent =
        '$/outbound/pax = ' +
        state.outPax +
        '  ·  $/return/pax = ' +
        state.retPax +
        '  ·  $/cabin = "' +
        cabinStr +
        '"  ·  $/totalEur = ' +
        total;
    }
  }

  const SPECTRUM_SNIPPETS = {
    prebuilt: {
      title: "Mode 1: Prebuilt Server-Driven UI (Zero LLM Latency)",
      badge: "Deterministic · a2ui.builder",
      code:
        "# Build deterministic UI in server code and stream data updates\n" +
        "from a2ui.builder.v0_9.catalogs.basic import Card, Column, Row, Text, Button\n\n" +
        "surface = Card(child=Column(children=[\n" +
        '    Text(text="Order #8492 Confirmed", variant="h2"),\n' +
        '    Row(children=[Button(child=Text(text="Track Package"), action=Action(name="track"))]),\n' +
        "]))",
    },
    mcp: {
      title: "Mode 2: MCP Apps & Embedded Webviews",
      badge: "Sandboxed · catalogs/mcp",
      code:
        "# Host an MCP App inside A2UI — or serve A2UI inside Claude, ChatGPT & VS Code\n" +
        "from a2ui.processor import A2uiGenerator, CatalogConfig\n\n" +
        "generator = A2uiGenerator([\n" +
        '    CatalogConfig.from_path("catalogs/basic/v1/catalog.json"),\n' +
        '    CatalogConfig.from_path("catalogs/mcp/v1/catalog.json"),  # Sandboxed ui:// resource\n' +
        "])",
    },
    macros: {
      title: "Mode 3: Controlled Generation with Server @macros",
      badge: "Domain Guardrails · Zero Layout Drift",
      code:
        "# Expose high-level domain macros; prune raw layout primitives\n" +
        "from a2ui.transformers.macros import MacroExpander, macro\n" +
        "from a2ui.catalog_transformers import ComponentPruningTransformer\n\n" +
        "@macro(description='Standardized flight comparison card')\n" +
        "def flight_card(flight: str, origin: str, dest: str, price_eur: int) -> Card:\n" +
        "    return Card(child=Row(children=[Text(text=f'{flight}: {origin} → {dest}'), Text(text=f'€{price_eur}')]))",
    },
    open: {
      title: "Mode 4: Open-Ended Generative UI with Express Inference",
      badge: "Maximum Autonomy · ExpressFormatFactory",
      code:
        "# Let the LLM compose dynamic forms & dashboards using compact Express syntax\n" +
        "from a2ui.core.basic_catalog import BasicCatalog\n" +
        "from a2ui.core.schema import ProtocolVersion\n" +
        "from a2ui.processor import A2uiGenerator, CatalogConfig\n\n" +
        "generator = A2uiGenerator([CatalogConfig(BasicCatalog(ProtocolVersion.V1_0))])\n" +
        "processor = generator.create_processor(client_capabilities)  # Defaults to ExpressFormat",
    },
  };

  const PLATFORM_CONFIGS = {
    swiftui: {
      title: "SwiftUI Native Renderer (iOS & macOS)",
      pkg: "A2UISwiftUI · BasicCatalogSwiftUI",
      chrome: "iOS 18 / macOS Sequoia · Native SwiftUI Views",
      badge: "Cupertino & SwiftUI",
      code:
        "import SwiftUI\n" +
        "import A2UISwiftCore\n" +
        "import A2UISwiftUI\n\n" +
        "struct AgentSurfaceScreen: View {\n" +
        "  @ObservedObject var processor: A2UIMessageProcessor\n" +
        "  var body: some View {\n" +
        '    A2UISurfaceView(surfaceId: "travel-booking", processor: processor)\n' +
        "  }\n" +
        "}",
    },
    compose: {
      title: "Jetpack Compose Native Renderer (AndroidX)",
      pkg: "androidx.a2ui · Jetpack Compose",
      chrome: "Android 15 · Material 3 Dynamic Color",
      badge: "Official AndroidX Library",
      code:
        "import androidx.compose.runtime.Composable\n" +
        "import androidx.a2ui.compose.A2uiSurface\n" +
        "import androidx.a2ui.core.SurfaceProcessor\n\n" +
        "@Composable\n" +
        "fun AgentBookingSheet(processor: SurfaceProcessor) {\n" +
        '    A2uiSurface(\n' +
        '        surfaceId = "travel-booking",\n' +
        "        processor = processor,\n" +
        "        catalog = BasicCatalog.v1_0\n" +
        "    )\n" +
        "}",
    },
    flutter: {
      title: "Flutter Multi-Platform Renderer (iOS, Android, Desktop, Web)",
      pkg: "a2ui_flutter · flutter/genui",
      chrome: "Flutter Impeller Engine · 60/120fps Native Widgets",
      badge: "pub.dev: a2ui_core & genui",
      code:
        "import 'package:flutter/material.dart';\n" +
        "import 'package:a2ui_flutter/a2ui_flutter.dart';\n" +
        "import 'package:a2ui_flutter/basic_catalog.dart';\n\n" +
        "Widget build(BuildContext context) {\n" +
        "  return A2uiSurface(\n" +
        "    surfaceId: 'travel-booking',\n" +
        "    processor: messageProcessor,\n" +
        "    catalog: createBasicCatalog(),\n" +
        "  );\n" +
        "}",
    },
    react: {
      title: "React Web Renderer (@a2ui/react)",
      pkg: "npm: @a2ui/react · @a2ui/web_core",
      chrome: "React 19 / Next.js · Native Design System Tokens",
      badge: "npm: @a2ui/react",
      code:
        'import { A2uiSurface, useA2uiProcessor } from "@a2ui/react";\n' +
        'import { basicCatalog } from "@a2ui/web_core";\n\n' +
        "export function AgentPanel({ stream }) {\n" +
        "  const processor = useA2uiProcessor({ catalogs: [basicCatalog], stream });\n" +
        "  return (\n" +
        '    <A2uiSurface surfaceId="travel-booking" processor={processor} />\n' +
        "  );\n" +
        "}",
    },
    angular: {
      title: "Angular Renderer (@a2ui/angular)",
      pkg: "npm: @a2ui/angular · @a2ui/web_core",
      chrome: "Angular Signals · Enterprise Host Surface",
      badge: "npm: @a2ui/angular",
      code:
        'import { Component, inject } from "@angular/core";\n' +
        'import { A2uiSurfaceComponent, A2uiMessageService } from "@a2ui/angular";\n\n' +
        "@Component({\n" +
        '  selector: "app-agent-surface",\n' +
        "  standalone: true,\n" +
        "  imports: [A2uiSurfaceComponent],\n" +
        '  template: `<a2ui-surface surfaceId="travel-booking" [processor]="processor" />`\n' +
        "})\n" +
        "export class AgentSurfaceHostComponent {}",
    },
    lit: {
      title: "Lit Web Components Renderer (@a2ui/lit)",
      pkg: "npm: @a2ui/lit · Framework-Agnostic Custom Elements",
      chrome: "Standards-Based Web Components · Shadow DOM",
      badge: "npm: @a2ui/lit",
      code:
        'import "@a2ui/lit/a2ui-surface.js";\n' +
        'import { MessageProcessor } from "@a2ui/web_core";\n\n' +
        "const processor = new MessageProcessor({ catalogs: [basicCatalog] });\n" +
        'const surfaceEl = document.querySelector("a2ui-surface");\n' +
        'surfaceEl.surfaceId = "travel-booking";\n' +
        "surfaceEl.processor = processor;",
    },
  };

  document.addEventListener("click", function (e) {
    const target = e.target.closest("[data-a2-action]");
    if (!target) return;

    const action = target.getAttribute("data-a2-action");

    if (action === "out-dec" && state.outPax > 1) {
      state.outPax--;
      state.booked = false;
      updateTravelWidget();
    } else if (action === "out-inc" && state.outPax < 6) {
      state.outPax++;
      state.booked = false;
      updateTravelWidget();
    } else if (action === "ret-dec" && state.retPax > 1) {
      state.retPax--;
      state.booked = false;
      updateTravelWidget();
    } else if (action === "ret-inc" && state.retPax < 6) {
      state.retPax++;
      state.booked = false;
      updateTravelWidget();
    } else if (action === "toggle-premium") {
      state.premium = !state.premium;
      state.booked = false;
      updateTravelWidget();
    } else if (action === "toggle-bags") {
      state.bags = !state.bags;
      state.booked = false;
      updateTravelWidget();
    } else if (action === "book-trip") {
      state.booked = !state.booked;
      updateTravelWidget();
    } else if (action === "copy-prompt") {
      const promptText =
        "Use A2UI Express format to respond with interactive UI surfaces.\n" +
        "Bind state paths with $/path = value and compose root = Card(...) using catalog components (Card, Column, Row, Text, Button, TextField, Slider, Tabs).";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(promptText);
      }
      const orig = target.textContent;
      target.textContent = "✓ Copied Agent Prompt";
      setTimeout(function () {
        target.textContent = orig;
      }, 2000);
    } else if (action === "select-spectrum") {
      const mode = target.getAttribute("data-mode");
      const info = SPECTRUM_SNIPPETS[mode];
      if (!info) return;
      document
        .querySelectorAll('[data-a2-action="select-spectrum"]')
        .forEach(function (el) {
          el.classList.toggle("is-active", el === target);
        });
      const titleEl = document.getElementById("a2-spec-code-title");
      const badgeEl = document.getElementById("a2-spec-code-badge");
      const codeEl = document.getElementById("a2-spec-code-pre");
      if (titleEl) titleEl.textContent = info.title;
      if (badgeEl) badgeEl.textContent = info.badge;
      if (codeEl) codeEl.textContent = info.code;
    } else if (action === "select-platform") {
      const plat = target.getAttribute("data-plat");
      const cfg = PLATFORM_CONFIGS[plat];
      if (!cfg) return;
      document
        .querySelectorAll('[data-a2-action="select-platform"]')
        .forEach(function (el) {
          el.classList.toggle("is-active", el === target);
        });
      const chromeEl = document.getElementById("a2-plat-chrome-label");
      const pkgEl = document.getElementById("a2-plat-pkg-label");
      const titleEl = document.getElementById("a2-plat-code-title");
      const badgeEl = document.getElementById("a2-plat-code-badge");
      const codeEl = document.getElementById("a2-plat-code-pre");
      if (chromeEl) chromeEl.textContent = cfg.chrome;
      if (pkgEl) pkgEl.textContent = cfg.pkg;
      if (titleEl) titleEl.textContent = cfg.title;
      if (badgeEl) badgeEl.textContent = cfg.badge;
      if (codeEl) codeEl.textContent = cfg.code;
    }
  });
})();
