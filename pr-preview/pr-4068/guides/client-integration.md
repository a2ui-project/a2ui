# How to Integrate A2UI into a Client

> Step-by-step guide to integrating A2UI client renderers into Flutter, React, Lit, Angular, SwiftUI, and Jetpack Compose apps.

Canonical URL: https://a2ui.org/guides/client-integration/

Integrate an A2UI [renderer](../../concepts/glossary/#renderer) into a Flutter, React, Lit, Angular, SwiftUI, or Jetpack Compose application using the [Renderer SDKs](/concepts/sdks/#renderer-sdk) to display interactive UIs from an AI agent and send user actions back.

If you are building the backend agent instead, see [How to Integrate with My Agent Server](../../guides/agent-integration/). To register custom widgets beyond the built-in Basic catalog, see [How to Define a Catalog](../../guides/defining-a-catalog/) and [Authoring Universal Web Components](../../guides/authoring-universal-components/).

---

## Step 1: Install dependencies

Install the Renderer SDK and Core SDK packages for your target UI framework:

#### Flutter

```bash
flutter pub add a2ui_flutter a2ui_core url_launcher
```

#### React

```bash
# Requires react and react-dom ^17.0.0 || ^18.0.0 || ^19.0.0
npm install @a2ui/react @a2ui/web_core @a2ui/markdown-it zod
```

#### Lit

```bash
npm install @a2ui/lit @a2ui/web_core @a2ui/markdown-it lit zod
```

#### Angular

```bash
# Requires @angular/core, @angular/common, and @angular/platform-browser ^21.2.5
npm install @a2ui/angular @a2ui/web_core @a2ui/markdown-it zod
```

#### SwiftUI

Add the Swift packages to `Package.swift` (iOS 17+ / macOS 14+):

```swift
dependencies: [
  .package(url: "https://github.com/a2ui-project/a2ui.git", branch: "main"),
  .package(url: "https://github.com/ajevans99/swift-json-schema", .upToNextMinor(from: "0.13.1")),
],
targets: [
  .target(
    name: "MyApp",
    dependencies: [
      .product(name: "A2UISwiftCore", package: "a2ui"),
      .product(name: "A2UISwiftUI", package: "a2ui"),
      .product(name: "BasicCatalogSwiftUI", package: "a2ui"),
      .product(name: "OrderedJSON", package: "swift-json-schema"),
    ]
  ),
]
```

#### Jetpack Compose

Add `google()` to your Gradle repositories and declare the `androidx.a2ui` dependencies in `build.gradle.kts`. `1.0.0-alpha02` currently targets A2UI `v0.9.1` on the wire while `v1.0` support is in progress:

```kotlin
dependencies {
    val a2uiVersion = "1.0.0-alpha02"
    implementation("androidx.a2ui:a2ui-model:$a2uiVersion")
    implementation("androidx.a2ui:a2ui-engine:$a2uiVersion")
    implementation("androidx.a2ui.compose:compose-runtime:$a2uiVersion")
    implementation("androidx.a2ui.compose:compose-ui:$a2uiVersion")
    implementation("androidx.compose.material3:material3-a2ui:$a2uiVersion")
}
```

---

## Step 2: Initialize MessageProcessor

Create a [`MessageProcessor`](../../concepts/glossary/#messageprocessor) instance inside a session controller or service with the built-in [Basic catalog](../../specification/v1.0-basic-catalog-implementation-guide/#basic_catalog.json) and an action callback that forwards user events to the transport method you will add in [Step 4](#step-4-connect-transport-and-handle-actions).

The scope of the rendering session determines which [surfaces](../../concepts/glossary/#surface) the agent can modify. In a chat app, you can use one `MessageProcessor` per conversation to allow the agent to update or delete any surface in the conversation at any time by its `surfaceId`, or use one `MessageProcessor` per chat turn so the agent only modifies surfaces in the active turn and does not need unique surface IDs across turns. To register custom components or local functions alongside the Basic catalog, see [How to Define a Catalog](../../guides/defining-a-catalog/).

#### Flutter

```dart
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:url_launcher/url_launcher.dart';

class AgentSession {
  AgentSession({required this.sendOverTransport}) {
    processor = MessageProcessor<ComponentImplementation>(
      catalogs: [
        basicCatalog(
          openUrl: (url) async {
            await launchUrl(url);
          },
        ),
        // Add custom domain catalogs here (see /guides/defining-a-catalog/).
      ],
      onAction: (action) {
        // Optional (default: null)
        sendToAgent(ActionMessage(version: '1.0', action: action).toJson());
      },
    );
  }

  final void Function(Map<String, Object?> message) sendOverTransport;

  late final MessageProcessor<ComponentImplementation> processor;
}
```

#### React

```ts
import {renderMarkdown} from '@a2ui/markdown-it';
import type {ReactCatalogComponent} from '@a2ui/react';
import {
  type ActionPayload,
  MessageProcessor,
  basicCatalog,
  injectBasicCatalogStyles,
  setMarkdownRenderer,
} from '@a2ui/web_core/v1_0';

injectBasicCatalogStyles();
setMarkdownRenderer(renderMarkdown);

export class AgentSession {
  readonly processor = new MessageProcessor<ReactCatalogComponent>(
    [
      basicCatalog,
      // Add custom domain catalogs here (see /guides/defining-a-catalog/).
    ],
    // Optional (default: undefined)
    (action: ActionPayload) => void this.sendToAgent({version: '1.0', action}),
  );
}
```

#### Lit

```ts
import type {LitComponentApi} from '@a2ui/lit';
import {renderMarkdown} from '@a2ui/markdown-it';
import {
  type ActionPayload,
  MessageProcessor,
  basicCatalog,
  injectBasicCatalogStyles,
  setMarkdownRenderer,
} from '@a2ui/web_core/v1_0';

injectBasicCatalogStyles();
setMarkdownRenderer(renderMarkdown);

export class AgentSession {
  readonly processor = new MessageProcessor<LitComponentApi>(
    [
      basicCatalog,
      // Add custom domain catalogs here (see /guides/defining-a-catalog/).
    ],
    // Optional (default: undefined)
    (action: ActionPayload) => void this.sendToAgent({version: '1.0', action}),
  );
}
```

#### Angular

```ts
import {ApplicationConfig, Injector, inject} from '@angular/core';
import {BasicCatalog, provideA2UI, provideMarkdownRenderer} from '@a2ui/angular';
import {renderMarkdown} from '@a2ui/markdown-it';
import {type ActionPayload, injectBasicCatalogStyles} from '@a2ui/web_core/v1_0';

import {AgentSessionService} from './agent-session.service';

injectBasicCatalogStyles();

export const appConfig: ApplicationConfig = {
  providers: [
    provideA2UI(() => {
      const injector = inject(Injector);
      return {
        catalogs: [
          new BasicCatalog(),
          // Add custom domain catalogs here (see /guides/defining-a-catalog/).
        ],
        // Optional (default: undefined)
        actionHandler: (action: ActionPayload) =>
          void injector.get(AgentSessionService).sendToAgent({version: '1.0', action}),
      };
    }),
    provideMarkdownRenderer(renderMarkdown),
  ],
};
```

#### SwiftUI

```swift
import A2UICore
import A2UISwiftUI
import BasicCatalogSwiftUI
import Combine
import Foundation

@MainActor
final class A2UISessionController: ObservableObject {
  let catalogs: [Catalog<ComponentImplementation>]
  let processor: MessageProcessor
  let sendOverTransport: @Sendable (Data) -> Void

  init(sendOverTransport: @escaping @Sendable (Data) -> Void) {
    self.sendOverTransport = sendOverTransport
    let basic = BasicCatalogImplementation.makeCatalog(version: .v10, locale: .current)
    // Add custom domain catalogs here (see /guides/defining-a-catalog/).
    self.catalogs = [basic]
    self.processor = MessageProcessor(
      catalogs: self.catalogs.map { $0 as any CatalogProtocol }
    )
    self.processor.outboundListener = { [weak self] message in
      // Optional (default: nil); receives .action, .callAgentFunction, .rendererFunctionResponse, and .error.
      Task { @MainActor [weak self] in
        try? self?.sendToAgent(message: message)
      }
    }
  }
}
```

#### Jetpack Compose

```kotlin
import android.app.Application
import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.a2ui.compose.ui.A2uiMessageProcessor
import androidx.a2ui.compose.ui.catalog.A2uiBasicCatalogV1
import androidx.a2ui.model.catalog.functions.A2uiLocaleProvider
import androidx.a2ui.model.processor.A2uiSurfaceModel
import androidx.a2ui.model.processor.processInput
import androidx.compose.material3.a2ui.catalog.MaterialA2uiBasicCatalogV1Defaults
import androidx.compose.material3.a2ui.catalog.materialA2uiBasicCatalogV1
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class AgentSessionViewModel(application: Application) : AndroidViewModel(application) {
    val basicCatalog = materialA2uiBasicCatalogV1(
        image = MaterialA2uiBasicCatalogV1Defaults.image { _, _, _, _, _ -> },
        video = MaterialA2uiBasicCatalogV1Defaults.video { _, _, _ -> },
        audioPlayer = MaterialA2uiBasicCatalogV1Defaults.audioPlayer { _, _, _, _ -> },
        functions = A2uiBasicCatalogV1.Functions(application, A2uiLocaleProvider.Default),
    )

    private val parser = A2uiMessageParser()
    val processor = A2uiMessageProcessor(
        catalogs = listOf(
            basicCatalog,
            // Add custom domain catalogs here (see /guides/defining-a-catalog/).
        ),
    )

    val a2uiSurfaces: StateFlow<List<A2uiSurfaceModel>> = processor.activeSurfaces

    init {
        viewModelScope.launch(Dispatchers.Default) {
            processor.collectMessages()
        }
        viewModelScope.launch(start = CoroutineStart.UNDISPATCHED) {
            processor.outboundEvents.collect { event ->
                handleOutboundEvent(event)
            }
        }
    }
}
```

---

## Step 3: Mount surface views

Create a container view that subscribes to the active [surfaces](../../concepts/glossary/#surface) on `MessageProcessor` and renders an A2UI surface component for each one. Your container mounts new surfaces when `createSurface` arrives and unmounts them when `deleteSurface` arrives, while each mounted surface observes its own component tree and `DataModel` internally to update child components in place as `updateComponents` and `updateDataModel` messages arrive.

#### Flutter

```dart
import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';

class AgentSurfacesView extends StatefulWidget {
  const AgentSurfacesView({super.key, required this.processor});

  final MessageProcessor<ComponentImplementation> processor;

  @override
  State<AgentSurfacesView> createState() => _AgentSurfacesViewState();
}

class _AgentSurfacesViewState extends State<AgentSurfacesView> {
  late final Subscription _createdSub;
  late final Subscription _deletedSub;

  @override
  void initState() {
    super.initState();
    _createdSub = widget.processor.model.onSurfaceCreated.subscribe((_) {
      setState(() {});
    });
    _deletedSub = widget.processor.model.onSurfaceDeleted.subscribe((_) {
      setState(() {});
    });
  }

  @override
  void dispose() {
    _createdSub.unsubscribe();
    _deletedSub.unsubscribe();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final surfaces = widget.processor.model.allSurfaces;
    return ListView(
      children: [
        for (final surface in surfaces)
          KeyedSubtree(
            key: ValueKey(surface.id),
            child: A2uiSurface(surface: surface),
          ),
      ],
    );
  }
}
```

#### React

```tsx
import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react';
import type {MessageProcessor, SurfaceModel} from '@a2ui/web_core/v1_0';
import {useEffect, useState} from 'react';

export function AgentSurfaces({processor}: {processor: MessageProcessor<ReactCatalogComponent>}) {
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactCatalogComponent>[]>(() =>
    Array.from(processor.getSurfaces().values()),
  );

  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.getSurfaces().values()));
    const createdSub = processor.onSurfaceCreated(sync);
    const deletedSub = processor.onSurfaceDeleted(sync);
    sync();
    return () => {
      createdSub.unsubscribe();
      deletedSub.unsubscribe();
    };
  }, [processor]);

  return (
    <div className="a2ui-surfaces">
      {surfaces.map(surface => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  );
}
```

#### Lit

```ts
import '@a2ui/lit';
import type {LitComponentApi} from '@a2ui/lit';
import type {MessageProcessor, Subscription} from '@a2ui/web_core/v1_0';
import {LitElement, type PropertyValues, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';

@customElement('agent-surfaces')
export class AgentSurfacesElement extends LitElement {
  @property({attribute: false})
  accessor processor!: MessageProcessor<LitComponentApi>;

  private subscriptions: Subscription[] = [];

  private subscribeToProcessor() {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    if (this.processor) {
      this.subscriptions.push(
        this.processor.onSurfaceCreated(() => this.requestUpdate()),
        this.processor.onSurfaceDeleted(() => this.requestUpdate()),
      );
    }
  }

  protected override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('processor')) {
      this.subscribeToProcessor();
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.processor && this.subscriptions.length === 0) {
      this.subscribeToProcessor();
    }
  }

  override disconnectedCallback() {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    super.disconnectedCallback();
  }

  override render() {
    const surfaces = this.processor ? Array.from(this.processor.getSurfaces().values()) : [];
    return html`
      ${repeat(
        surfaces,
        surface => surface.id,
        surface => html`<a2ui-surface .surface=${surface}></a2ui-surface>`,
      )}
    `;
  }
}
```

#### Angular

```ts
import {ChangeDetectionStrategy, Component, DestroyRef, inject, signal} from '@angular/core';
import {A2uiRendererService, SurfaceComponent} from '@a2ui/angular';

@Component({
  selector: 'app-agent-surfaces',
  standalone: true,
  imports: [SurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (surfaceId of surfaceIds(); track surfaceId) {
      <a2ui-v09-surface [surfaceId]="surfaceId" />
    }
  `,
})
export class AgentSurfacesComponent {
  private readonly renderer = inject(A2uiRendererService);
  private readonly destroyRef = inject(DestroyRef);

  readonly surfaceIds = signal<string[]>(this.readSurfaceIds());

  constructor() {
    const sync = () => this.surfaceIds.set(this.readSurfaceIds());
    const createdSub = this.renderer.surfaceGroup.onSurfaceCreated.subscribe(sync);
    const deletedSub = this.renderer.surfaceGroup.onSurfaceDeleted.subscribe(sync);
    this.destroyRef.onDestroy(() => {
      createdSub.unsubscribe();
      deletedSub.unsubscribe();
    });
  }

  private readSurfaceIds(): string[] {
    return Array.from(this.renderer.surfaceGroup.surfacesMap.keys());
  }
}
```

> **Note**
  In `@a2ui/angular`, `SurfaceComponent` currently uses the `<a2ui-v09-surface>` selector for A2UI
  `v1.0` surfaces (tracked in [#4009](https://github.com/a2ui-project/a2ui/issues/4009)). The
  unversioned `<a2ui-surface>` selector in `@a2ui/angular/v0_8` belongs only to the legacy `v0.8`
  renderer.

#### SwiftUI

```swift
import A2UICore
import A2UISwiftUI
import SwiftUI

struct AgentSurfacesView: View {
  @ObservedObject var surfaceGroup: SurfaceGroupModel
  let catalogs: [Catalog<ComponentImplementation>]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        ForEach(surfaceGroup.surfacesMap.keys.sorted(), id: \.self) { surfaceID in
          if let viewModel = surfaceGroup.surfacesMap[surfaceID] {
            Surface(viewModel: viewModel, catalogs: catalogs)
          }
        }
      }
      .padding()
    }
  }
}
```

#### Jetpack Compose

```kotlin
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.a2ui.A2uiSurface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun AgentSurfacesScreen(viewModel: AgentSessionViewModel, modifier: Modifier = Modifier) {
    val surfaces by viewModel.a2uiSurfaces.collectAsStateWithLifecycle()

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        surfaces.forEach { surface ->
            key(surface.id) {
                A2uiSurface(surfaceModel = surface)
            }
        }
    }
}
```

---

## Step 4: Connect transport and handle actions

Add inbound and outbound transport methods to your session controller or service to decode incoming JSON payloads into `MessageProcessor` and send resolved [`action`](../../concepts/messages/#action) messages back to your agent. A2UI is transport-agnostic, so these methods can exchange messages over HTTP responses, Server-Sent Events (SSE), WebSockets, [A2A](../../specification/v1.0-a2ui-extension-specification/), or [MCP](../../guides/mcp-overview/).

#### Flutter

```dart
void onTransportChunk(String rawJson) {
  final Object? decoded = jsonDecode(rawJson);
  processor.processMessages(decoded);
}

void sendToAgent(Map<String, Object?> wireMessage) {
  sendOverTransport(wireMessage);
}
```

#### React

```ts
async onTransportChunk(rawJson: string): Promise<void> {
  const payload = JSON.parse(rawJson);
  await this.processor.processMessagesAsync(payload);
}

async sendToAgent(wireMessage: unknown): Promise<void> {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message: wireMessage}),
  });
  if (!response.ok) return;
  const body = (await response.text()).trim();
  if (body) {
    await this.onTransportChunk(body);
  }
}
```

#### Lit

```ts
async onTransportChunk(rawJson: string): Promise<void> {
  const payload = JSON.parse(rawJson);
  await this.processor.processMessagesAsync(payload);
}

async sendToAgent(wireMessage: unknown): Promise<void> {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message: wireMessage}),
  });
  if (!response.ok) return;
  const body = (await response.text()).trim();
  if (body) {
    await this.onTransportChunk(body);
  }
}
```

#### Angular

```ts
import {Injectable, inject} from '@angular/core';
import {A2uiRendererService} from '@a2ui/angular';

@Injectable({providedIn: 'root'})
export class AgentSessionService {
  private readonly renderer = inject(A2uiRendererService);

  async onTransportChunk(rawJson: string): Promise<void> {
    const payload = JSON.parse(rawJson);
    await this.renderer.processMessagesAsync(payload);
  }

  async sendToAgent(wireMessage: unknown): Promise<void> {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: wireMessage}),
    });
    if (!response.ok) return;
    const body = (await response.text()).trim();
    if (body) {
      await this.onTransportChunk(body);
    }
  }
}
```

#### SwiftUI

```swift
import A2UICore
import Foundation
import OrderedJSON

extension A2UISessionController {
  func onTransportChunk(_ rawData: Data) throws {
    let payload = try JSONValue.parse(rawData)
    processor.process(payload: payload)
  }

  func sendToAgent(message: RendererToAgentMessage) throws {
    let messageData = try JSONEncoder().encode(message)
    let envelope: JSONValue = [
      "message": try JSONValue.parse(messageData),
    ]
    sendOverTransport(try JSONEncoder().encode(envelope))
  }
}
```

#### Jetpack Compose

Because `1.0.0-alpha02` targets A2UI `v0.9.1`, `A2uiMessageParser` expects one `"version": "v0.9"` (or `"v0.9.1"`) JSON message object per call rather than a JSON array, with `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` and `{"path": "..."}` data bindings, and outbound envelopes set `"version"` to `"v0.9"`:

```kotlin
import androidx.a2ui.model.protocol.A2uiClientErrorMessage
import androidx.a2ui.model.protocol.A2uiClientEventMessage
import androidx.a2ui.model.protocol.A2uiClientToServerMessage
import java.time.Instant

// Pass one JSON message object per call, not a JSON array.
fun onTransportMessage(rawJsonObject: String) {
    processor.processInput(parser, rawJsonObject)
}

private fun handleOutboundEvent(event: A2uiClientToServerMessage) {
    when (event) {
        is A2uiClientEventMessage -> {
            val wireMessage = mapOf(
                "version" to "v0.9",
                "action" to mapOf(
                    "name" to event.type,
                    "surfaceId" to event.surfaceId,
                    "sourceComponentId" to event.componentId,
                    "timestamp" to Instant.ofEpochMilli(event.timestamp).toString(),
                    "context" to event.context,
                ),
            )
            sendOverTransport(wireMessage)
        }
        is A2uiClientErrorMessage -> {
            val wireError = mapOf(
                "version" to "v0.9",
                "error" to mapOf(
                    "code" to event.code,
                    "surfaceId" to event.surfaceId,
                    "message" to event.message,
                ) + event.context,
            )
            sendOverTransport(wireError)
        }
    }
}

private fun sendOverTransport(message: Map<String, Any?>) {
    // POST mapOf("message" to message) to your agent endpoint and pass each
    // incoming JSON message object back to onTransportMessage(...).
}
```

<details>
<summary>Wire format: agent-to-renderer messages</summary>

Agents send [`createSurface`](../../concepts/messages/#createsurface) followed by incremental [`updateComponents`](../../concepts/messages/#updatecomponents) and [`updateDataModel`](../../concepts/messages/#updatedatamodel) messages, and remove finished surfaces with [`deleteSurface`](../../concepts/messages/#deletesurface):

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'agent_to_renderer.json',
      href: '/specification/v1.0/schemas/#agent_to_renderer.json',
      title: 'v1.0 Agent-to-Renderer Message Schema',
    },
    {
      version: 'v0.9.1',
      label: 'server_to_client.json',
      href: '/specification/v0.9.1/schemas/#server_to_client.json',
      title: 'v0.9.1 Server-to-Client Message Schema',
    },
  ]}
/>

#### v1.0

```json
[
  {
    "version": "1.0",
    "createSurface": {
      "surfaceId": "order_summary",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "1.0",
    "updateComponents": {
      "surfaceId": "order_summary",
      "components": [
        {"id": "root", "component": "Card", "child": "col"},
        {"id": "col", "component": "Column", "children": ["headline", "confirm_btn"]},
        {"id": "headline", "component": "Text", "text": {"@path": "/summaryText"}},
        {
          "id": "confirm_btn",
          "component": "Button",
          "child": "confirm_label",
          "action": {
            "event": {"name": "confirm_order", "context": {"orderId": {"@path": "/orderId"}}}
          }
        },
        {"id": "confirm_label", "component": "Text", "text": "Confirm order"}
      ]
    }
  },
  {
    "version": "1.0",
    "updateDataModel": {
      "surfaceId": "order_summary",
      "path": "/",
      "value": {"orderId": "ORD-4821", "summaryText": "2 items ready for pickup"}
    }
  }
]
```

#### v0.9.1

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "order_summary",
      "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "order_summary",
      "components": [
        {"id": "root", "component": "Card", "child": "col"},
        {"id": "col", "component": "Column", "children": ["headline", "confirm_btn"]},
        {"id": "headline", "component": "Text", "text": {"path": "/summaryText"}},
        {
          "id": "confirm_btn",
          "component": "Button",
          "child": "confirm_label",
          "action": {
            "event": {"name": "confirm_order", "context": {"orderId": {"path": "/orderId"}}}
          }
        },
        {"id": "confirm_label", "component": "Text", "text": "Confirm order"}
      ]
    }
  },
  {
    "version": "v0.9",
    "updateDataModel": {
      "surfaceId": "order_summary",
      "path": "/",
      "value": {"orderId": "ORD-4821", "summaryText": "2 items ready for pickup"}
    }
  }
]
```

</details>

<details>
<summary>Wire format: outbound action message</summary>

When the user clicks **Confirm order**, `MessageProcessor` resolves `context` bindings against the surface `DataModel` and passes the `action` message to `sendToAgent`:

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'renderer_to_agent.json',
      href: '/specification/v1.0/schemas/#renderer_to_agent.json',
      title: 'v1.0 Renderer-to-Agent Message Schema',
    },
    {
      version: 'v0.9.1',
      label: 'client_to_server.json',
      href: '/specification/v0.9.1/schemas/#client_to_server.json',
      title: 'v0.9.1 Client-to-Server Message Schema',
    },
  ]}
/>

#### v1.0

```json
{
  "version": "1.0",
  "action": {
    "name": "confirm_order",
    "surfaceId": "order_summary",
    "sourceComponentId": "confirm_btn",
    "timestamp": "2026-05-01T18:30:00.000Z",
    "context": {
      "orderId": "ORD-4821"
    }
  }
}
```

#### v0.9.1

```json
{
  "version": "v0.9",
  "action": {
    "name": "confirm_order",
    "surfaceId": "order_summary",
    "sourceComponentId": "confirm_btn",
    "timestamp": "2026-05-01T18:30:00.000Z",
    "context": {
      "orderId": "ORD-4821"
    }
  }
}
```

</details>

---

## Step 5: Wire everything at the app entry point

Instantiate your session controller or service at the application entry point and pass its `MessageProcessor` to the surface container view from [Step 3](#step-3-mount-surface-views). Sharing this session connects user prompts and bidirectional agent messages to the rendered surfaces:

#### Flutter

```dart
import 'package:flutter/material.dart';

import 'agent_session.dart';
import 'agent_surfaces_view.dart';

void main() {
  late final AgentSession session;
  session = AgentSession(
    sendOverTransport: (message) {
      // POST {'message': message} to your agent endpoint and pass each incoming
      // JSON payload back to session.onTransportChunk(chunk).
    },
  );

  runApp(
    MaterialApp(
      home: Scaffold(
        body: AgentSurfacesView(processor: session.processor),
        floatingActionButton: FloatingActionButton(
          onPressed: () {
            // Start an agent turn and pass each incoming JSON payload to
            // session.onTransportChunk(chunk).
          },
          child: const Icon(Icons.send),
        ),
      ),
    ),
  );
}
```

#### React

```tsx
import {useState} from 'react';

import {AgentSurfaces} from './AgentSurfaces';
import {AgentSession} from './agent-session';

export function App() {
  const [session] = useState(() => new AgentSession());

  async function startPrompt(prompt: string) {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt}),
    });
    if (!response.ok) return;
    const body = (await response.text()).trim();
    if (body) {
      await session.onTransportChunk(body);
    }
  }

  return (
    <main>
      <button type="button" onClick={() => void startPrompt('Show my order summary')}>
        Ask Agent
      </button>
      <AgentSurfaces processor={session.processor} />
    </main>
  );
}
```

#### Lit

```ts
import {LitElement, html} from 'lit';
import {customElement} from 'lit/decorators.js';

import {AgentSession} from './agent-session.js';
import './agent-surfaces.js';

@customElement('my-app')
export class MyAppElement extends LitElement {
  private readonly session = new AgentSession();

  private async startPrompt(prompt: string) {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt}),
    });
    if (!response.ok) return;
    const body = (await response.text()).trim();
    if (body) {
      await this.session.onTransportChunk(body);
    }
  }

  override render() {
    return html`
      <button type="button" @click=${() => void this.startPrompt('Show my order summary')}>
        Ask Agent
      </button>
      <agent-surfaces .processor=${this.session.processor}></agent-surfaces>
    `;
  }
}
```

#### Angular

```ts
import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';

import {AgentSessionService} from './app/agent-session.service';
import {AgentSurfacesComponent} from './app/agent-surfaces.component';
import {appConfig} from './app/app.config';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AgentSurfacesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" (click)="startPrompt('Show my order summary')">Ask Agent</button>
    <app-agent-surfaces />
  `,
})
export class AppComponent {
  private readonly session = inject(AgentSessionService);

  async startPrompt(prompt: string): Promise<void> {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt}),
    });
    if (!response.ok) return;
    const body = (await response.text()).trim();
    if (body) {
      await this.session.onTransportChunk(body);
    }
  }
}

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
```

#### SwiftUI

```swift
import Foundation
import OrderedJSON
import SwiftUI

@main
struct MyApp: App {
  @StateObject private var session = A2UISessionController { outboundBytes in
    // POST outboundBytes to your agent endpoint and pass incoming payloads back to
    // session.onTransportChunk(_:)
    _ = outboundBytes
  }

  var body: some Scene {
    WindowGroup {
      VStack {
        Button("Ask Agent") {
          Task {
            let requestBody: JSONValue = [
              "prompt": "Show my order summary",
            ]
            _ = try JSONEncoder().encode(requestBody)
            // Send encoded requestBody over URLSession and pass each response payload to:
            // try session.onTransportChunk(chunkData)
          }
        }
        AgentSurfacesView(
          surfaceGroup: session.processor.surfaceGroupModel,
          catalogs: session.catalogs
        )
      }
    }
  }
}
```

#### Jetpack Compose

```kotlin
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    private val sessionViewModel: AgentSessionViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Column {
                    Button(
                        onClick = {
                            // Start an agent turn and pass each incoming JSON message object to
                            // sessionViewModel.onTransportMessage(jsonObject).
                        },
                    ) {
                        Text("Ask Agent")
                    }
                    AgentSurfacesScreen(viewModel = sessionViewModel)
                }
            }
        }
    }
}
```

---

## Additional steps

### Customize Basic Catalog theme tokens on Web

Override the `--a2ui-*` CSS custom properties on `:root` or a container element to match your application's theme, or apply the `.a2ui-dark` and `.a2ui-light` classes to lock a color scheme. Calling `injectBasicCatalogStyles()` in [Step 2](#step-2-initialize-messageprocessor) adopts the default stylesheet into `document.adoptedStyleSheets` (and no-ops during server-side rendering):

```css
:root {
  --a2ui-color-primary: #0f766e;
  --a2ui-color-on-primary: #ffffff;
  --a2ui-color-background: #ffffff;
  --a2ui-color-surface: #f8fafc;
  --a2ui-color-on-background: #0f172a;
  --a2ui-font-family-title: 'Plus Jakarta Sans', system-ui, sans-serif;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
}
```

In React, `setMarkdownRenderer(renderMarkdown)` from [Step 2](#step-2-initialize-messageprocessor) configures the built-in Basic catalog `Text` elements; if your custom React catalog components call `useMarkdownRenderer()`, also wrap your tree in `<MarkdownContext.Provider value={renderMarkdown}>` from `@a2ui/react`.

### Advertise renderer capabilities

Call `getRendererCapabilities()` on `MessageProcessor` and attach the result to your outbound transport [metadata](../../concepts/messages/#metadata) under `a2uiRendererCapabilities` so the agent knows which catalogs and protocol versions your client supports. If your team owns both the agent and the client app with a fixed catalog set, you can skip runtime negotiation and target those catalogs directly on the agent. Keep `includeInlineCatalogs` at its default `false` in production when the agent already holds matching `catalogId` schemas; set it to `true` only during prototyping when the agent accepts client-supplied inline schemas.

#### Flutter

```dart
Map<String, Object?> buildCapabilitiesMetadata() {
  final capabilities = processor
      .getRendererCapabilities(
        const CapabilitiesOptions(
          versions: [A2uiProtocolVersion.v1_0],
          includeInlineCatalogs: false, // Optional (default: false)
        ),
      )
      .toJson();

  return {
    'a2uiRendererCapabilities': capabilities,
  };
}
```

#### React

```ts
buildCapabilitiesMetadata() {
  return {
    a2uiRendererCapabilities: this.processor.getRendererCapabilities({
      versions: ['1.0'],
      includeInlineCatalogs: false, // Optional (default: false)
    }),
  };
}
```

#### Lit

```ts
buildCapabilitiesMetadata() {
  return {
    a2uiRendererCapabilities: this.processor.getRendererCapabilities({
      versions: ['1.0'],
      includeInlineCatalogs: false, // Optional (default: false)
    }),
  };
}
```

#### Angular

```ts
buildCapabilitiesMetadata() {
  return {
    a2uiRendererCapabilities: this.renderer.processor.getRendererCapabilities({
      versions: ['1.0'],
      includeInlineCatalogs: false, // Optional (default: false)
    }),
  };
}
```

#### SwiftUI

```swift
import A2UICore
import OrderedJSON

extension A2UISessionController {
  func buildCapabilitiesMetadata() throws -> JSONValue {
    let capabilities = try processor.getRendererCapabilities(
      options: MessageProcessor.CapabilitiesOptions(
        versions: [.v10],
        includeInlineCatalogs: false // Optional (default: false)
      )
    )
    return [
      "a2uiRendererCapabilities": capabilities,
    ]
  }
}
```

#### Jetpack Compose

Because `1.0.0-alpha02` targets A2UI `v0.9.1`, capabilities are advertised under `a2uiClientCapabilities` (keyed by `"v0.9"`):

```kotlin
import androidx.a2ui.model.protocol.A2uiClientCapabilities

val capabilities = A2uiClientCapabilities(
    supportedCatalogIds = listOf(basicCatalog.id),
    inlineCatalogs = emptyList(), // Optional (default: emptyList())
)

fun buildCapabilitiesMetadata(): Map<String, Map<String, Any?>> {
    // Returns mapOf("a2uiClientCapabilities" to mapOf("v0.9" to mapOf("supportedCatalogIds" to listOf(...))))
    return capabilities.toPayloadMap()
}
```

<details>
<summary>Wire format: renderer capabilities metadata</summary>

`buildCapabilitiesMetadata()` produces the transport metadata envelope below (`"1.0"` in `v1.0`, `"v0.9"` in `v0.9.1`):

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'renderer_capabilities.json',
      href: '/specification/v1.0/schemas/#renderer_capabilities.json',
      title: 'v1.0 Renderer Capabilities Schema',
    },
    {
      version: 'v0.9.1',
      label: 'client_capabilities.json',
      href: '/specification/v0.9.1/schemas/#client_capabilities.json',
      title: 'v0.9.1 Client Capabilities Schema',
    },
  ]}
/>

#### v1.0

```json
{
  "metadata": {
    "a2uiRendererCapabilities": {
      "1.0": {
        "supportedCatalogIds": ["https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"]
      }
    }
  }
}
```

#### v0.9.1

```json
{
  "metadata": {
    "a2uiClientCapabilities": {
      "v0.9": {
        "supportedCatalogIds": ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"]
      }
    }
  }
}
```

</details>

### Synchronize client data models and forward RPCs

Call `getRendererDataModel()` on `MessageProcessor` and attach the returned snapshot under `a2uiRendererDataModel` in your outbound transport metadata alongside `action` messages and user prompts. `MessageProcessor` returns data models for active surfaces created with `"sendDataModel": true`, such as multi-field forms where local input edits update the client `DataModel` without firing separate action events.

If your catalogs use v1.0 remote agent functions ([`callAgentFunction`](../../concepts/messages/#callagentfunction-v10-only)) or agent-initiated client calls ([`callRendererFunction`](../../concepts/messages/#callrendererfunction-v10-only)), pass `outboundListener` to `MessageProcessor` (`processorOptions.outboundListener` in Angular) to forward those envelopes through `sendToAgent`. To report malformed incoming payloads back to the agent as structured [`error`](../../specification/v1.0/schemas/#renderer_to_agent.json/properties/error) messages instead of throwing exceptions, set `reportErrorsOnly: true` (paired with `errorHandler` on Web, or `outboundListener` on Flutter; SwiftUI and Jetpack Compose already emit validation errors on `outboundListener` and `outboundEvents`).

#### Flutter

```dart
Map<String, Object?> buildDataModelMetadata() {
  final dataModel = processor.getRendererDataModel();
  return {
    if (dataModel != null) 'a2uiRendererDataModel': dataModel,
  };
}
```

#### React

```ts
buildDataModelMetadata(): Record<string, unknown> {
  const dataModel = this.processor.getRendererDataModel();
  return dataModel !== undefined ? {a2uiRendererDataModel: dataModel} : {};
}
```

#### Lit

```ts
buildDataModelMetadata(): Record<string, unknown> {
  const dataModel = this.processor.getRendererDataModel();
  return dataModel !== undefined ? {a2uiRendererDataModel: dataModel} : {};
}
```

#### Angular

```ts
buildDataModelMetadata(): Record<string, unknown> {
  const dataModel = this.renderer.processor.getRendererDataModel();
  return dataModel !== undefined ? {a2uiRendererDataModel: dataModel} : {};
}
```

#### SwiftUI

```swift
import A2UICore
import OrderedJSON

extension A2UISessionController {
  func buildDataModelMetadata() throws -> JSONValue {
    if let dataModel = try processor.getRendererDataModel() {
      return [
        "a2uiRendererDataModel": dataModel,
      ]
    }
    return [:]
  }
}
```

#### Jetpack Compose

Because `1.0.0-alpha02` targets A2UI `v0.9.1`, `A2uiClientEventMessage.clientDataModel` is populated automatically for `sendDataModel = true` surfaces and attached under `a2uiClientDataModel`:

```kotlin
val metadata = buildMap<String, Any?> {
    event.clientDataModel?.let {
        put(
            "a2uiClientDataModel",
            mapOf("version" to "v0.9", "surfaces" to it.surfaces),
        )
    }
}
```

<details>
<summary>Wire format: outbound action with data-model metadata</summary>

When the user triggers an action on a `"sendDataModel": true` surface, attaching `buildDataModelMetadata()` alongside `message` produces the transport envelope below:

<SchemaChips
  items={[
    {
      version: 'v1.0',
      label: 'renderer_to_agent.json',
      href: '/specification/v1.0/schemas/#renderer_to_agent.json',
      title: 'v1.0 Renderer-to-Agent Message Schema',
    },
    {
      version: 'v1.0',
      label: 'renderer_data_model.json',
      href: '/specification/v1.0/schemas/#renderer_data_model.json',
      title: 'v1.0 Renderer Data Model Metadata Schema',
    },
    {
      version: 'v0.9.1',
      label: 'client_to_server.json',
      href: '/specification/v0.9.1/schemas/#client_to_server.json',
      title: 'v0.9.1 Client-to-Server Message Schema',
    },
    {
      version: 'v0.9.1',
      label: 'client_data_model.json',
      href: '/specification/v0.9.1/schemas/#client_data_model.json',
      title: 'v0.9.1 Client Data Model Metadata Schema',
    },
  ]}
/>

#### v1.0

```json
{
  "message": {
    "version": "1.0",
    "action": {
      "name": "confirm_order",
      "surfaceId": "order_summary",
      "sourceComponentId": "confirm_btn",
      "timestamp": "2026-05-01T18:30:00.000Z",
      "context": {
        "orderId": "ORD-4821"
      }
    }
  },
  "metadata": {
    "a2uiRendererDataModel": {
      "version": "1.0",
      "surfaces": {
        "order_summary": {
          "orderId": "ORD-4821",
          "summaryText": "2 items ready for pickup"
        }
      }
    }
  }
}
```

#### v0.9.1

```json
{
  "message": {
    "version": "v0.9",
    "action": {
      "name": "confirm_order",
      "surfaceId": "order_summary",
      "sourceComponentId": "confirm_btn",
      "timestamp": "2026-05-01T18:30:00.000Z",
      "context": {
        "orderId": "ORD-4821"
      }
    }
  },
  "metadata": {
    "a2uiClientDataModel": {
      "version": "v0.9",
      "surfaces": {
        "order_summary": {
          "orderId": "ORD-4821",
          "summaryText": "2 items ready for pickup"
        }
      }
    }
  }
}
```

</details>
