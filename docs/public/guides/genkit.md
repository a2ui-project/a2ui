# Building A2UI Agents with Genkit

[Google Genkit](https://genkit.dev/) is an open-source framework for building production-ready AI applications and agents across **JavaScript/TypeScript**, **Go**, **Dart**, and **Python**.

Genkit provides first-class A2UI support through dedicated server middleware and client helpers in its **JavaScript/TypeScript** (`@genkit-ai/a2ui`), **Go** (`github.com/firebase/genkit/go/plugins/a2ui/exp`), and **Dart** (`package:genkit_a2ui`) SDKs. Because emitted envelopes follow the A2A binding of the A2UI specification (`application/a2ui+json`), any Genkit backend—whether written in TypeScript, Go, or Dart—can stream interactive surfaces to web clients (`@a2ui/lit`, `@a2ui/react`, `@a2ui/angular`) or Flutter applications (`package:genui`).

For complete, language-specific documentation, visit the **[Genkit Generative UI (A2UI) Documentation](https://genkit.dev/docs/agents/a2ui)**.

---

## How Genkit Supports A2UI

Instead of manually embedding JSON schemas into prompts or writing custom output parsers, Genkit handles the A2UI lifecycle through its middleware architecture:

1. **Component Catalogs**: Use the bundled 12-component **basic catalog** (`Card`, `Row`, `Column`, `List`, `Text`, `Image`, `Icon`, `Button`, `TextField`, `CheckBox`, `Slider`, `Divider`) out of the box, or register custom catalogs tailored to your design system.
2. **Automatic Prompt Injection**: Attaching the A2UI middleware to your Genkit agent or `generate()` call automatically injects your active catalog's component definitions into the model's system instructions.
3. **Schema Validation & Self-Correction**: As the model streams A2UI surface updates, the middleware extracts A2UI blocks, validates every envelope against your catalog schema, and rewrites them into standardized Genkit data parts (`application/a2ui+json`).
4. **Two-Way Interactive Streaming**: Streamed chunks carry both conversational text deltas and validated A2UI envelopes (`a2uiEnvelopesFromParts`). When a user interacts with a rendered widget (such as clicking a button or submitting a form), the client packages their choices into an `A2uiClientAction` and sends it back as the next turn using `actionToMessage`.

---

## 1. Add A2UI Middleware on the Server

Choose your Genkit backend language and attach the A2UI middleware to your agent or generation pipeline:

=== "JavaScript / TypeScript"

    Install `@genkit-ai/a2ui` alongside your core Genkit packages:

    ```bash
    npm install @genkit-ai/a2ui genkit @genkit-ai/google-genai @genkit-ai/express
    ```

    Pass `a2ui()` in your agent's `use` array:

    ```ts
    import { genkit, InMemorySessionStore } from 'genkit/beta';
    import { googleAI } from '@genkit-ai/google-genai';
    import { a2ui } from '@genkit-ai/a2ui';
    import { expressHandler } from '@genkit-ai/express';
    import express from 'express';

    const ai = genkit({ plugins: [googleAI()] });

    export const uiAgent = ai.defineAgent({
      name: 'uiAgent',
      model: googleAI.model('gemini-flash-latest'),
      system:
        'You are an interactive assistant. Render an A2UI surface whenever a ' +
        'visual display is clearer than plain prose. Keep text responses brief.',
      use: [a2ui()], // defaults to the bundled 'basic' catalog
      store: new InMemorySessionStore(),
    });

    const app = express();
    app.use(express.json());
    app.post('/api/uiAgent', expressHandler(uiAgent));
    app.listen(8080);
    ```

    See the [Genkit JavaScript/TypeScript A2UI Docs](https://genkit.dev/docs/js/agents/a2ui) for custom catalog registration and configuration options.

=== "Go"

    Add the A2UI plugin to your Go module:

    ```bash
    go get github.com/firebase/genkit/go/plugins/a2ui/exp
    ```

    Attach `&a2uix.Surfaces{}` with `ai.WithUse` to your agent prompt or `genkit.Generate` call:

    ```go
    package main

    import (
    	"context"
    	"net/http"

    	"github.com/firebase/genkit/go/ai"
    	aix "github.com/firebase/genkit/go/ai/exp"
    	"github.com/firebase/genkit/go/ai/exp/localstore"
    	"github.com/firebase/genkit/go/genkit"
    	genkitx "github.com/firebase/genkit/go/genkit/exp"
    	a2uix "github.com/firebase/genkit/go/plugins/a2ui/exp"
    	"github.com/firebase/genkit/go/plugins/googlegenai"
    	"github.com/firebase/genkit/go/plugins/middleware"
    )

    func main() {
    	ctx := context.Background()
    	g := genkit.Init(ctx,
    		genkit.WithExperimental(),
    		genkit.WithPlugins(&googlegenai.GoogleAI{}, &a2uix.A2UI{}),
    	)

    	uiAgent := genkitx.DefineAgent(g, "uiAgent",
    		aix.InlinePrompt{
    			ai.WithModelName("googleai/gemini-flash-latest"),
    			ai.WithSystem("You help users. Render UI when it is clearer than prose."),
    			ai.WithUse(&middleware.Retry{MaxRetries: 5}, &a2uix.Surfaces{}),
    		},
    		aix.WithSessionStore(localstore.NewInMemorySessionStore[any]()),
    	)

    	mux := http.NewServeMux()
    	mux.Handle("/api/uiAgent", genkit.Handler(uiAgent))
    	mux.Handle("/api/uiAgent/getSnapshot", genkit.Handler(uiAgent.GetSnapshotAction()))
    	mux.Handle("/api/uiAgent/abort", genkit.Handler(uiAgent.AbortAction()))
    	http.ListenAndServe(":8080", mux)
    }
    ```

    See the [Genkit Go A2UI Docs](https://genkit.dev/docs/go/agents/a2ui) and the [Go A2UI Sample](https://github.com/genkit-ai/genkit/tree/main/go/samples/basic-middleware/a2ui).

=== "Dart"

    Add `genkit_a2ui` alongside your core Genkit packages:

    ```bash
    dart pub add genkit genkit_a2ui genkit_google_genai genkit_shelf shelf_router
    ```

    Register `A2uiPlugin()` in `Genkit(plugins: [...])` and pass `a2ui()` in your agent's `use` list:

    ```dart
    import 'package:genkit/experimental.dart';
    import 'package:genkit/genkit.dart';
    import 'package:genkit_a2ui/a2ui.dart';
    import 'package:genkit_google_genai/genkit_google_genai.dart';
    import 'package:genkit_shelf/genkit_shelf.dart';
    import 'package:shelf/shelf_io.dart' as io;
    import 'package:shelf_router/shelf_router.dart';

    // Register A2uiPlugin so `use: [a2ui()]` resolves from the registry
    final ai = Genkit(plugins: [googleAI(), A2uiPlugin()]);

    final uiAgent = ai.defineAgent(
      name: 'uiAgent',
      model: googleAI.gemini('gemini-flash-latest'),
      system:
          'You help users. Render an A2UI surface whenever a result is clearer '
          'shown than told. Keep prose brief; put the primary substance in the UI.',
      use: [a2ui()], // defaults to the bundled 'basic' catalog
      store: InMemorySessionStore(),
    );

    void main() async {
      final app = Router()
        ..post('/api/uiAgent', shelfHandler(uiAgent.action))
        ..post('/api/uiAgent/getSnapshot', shelfHandler(uiAgent.getSnapshotDataAction))
        ..post('/api/uiAgent/abort', shelfHandler(uiAgent.abortAgentAction));

      await io.serve(app.call, 'localhost', 8080);
    }
    ```

    See the [Genkit Dart A2UI Docs](https://genkit.dev/docs/dart/agents/a2ui), the [Dart A2UI Testapp](https://github.com/genkit-ai/genkit-dart/tree/main/testapps/a2ui), and the [Full-Stack Dart & Flutter Sample](https://github.com/genkit-ai/samples/tree/main/a2ui-reservations_dart).

---

## 2. Render Surfaces & Handle Actions on the Client

Client applications connect to any Genkit backend endpoint (`POST /api/uiAgent`), extract A2UI envelopes from streamed chunks using `a2uiEnvelopesFromParts`, and send user interactions back as the next conversational turn with `actionToMessage`:

=== "Web (JavaScript / Lit)"

    ```ts
    import { MessageProcessor } from '@a2ui/web_core/v0_9';
    import { basicCatalog } from '@a2ui/lit/v0_9';
    import { remoteAgent } from 'genkit/beta/client';
    import {
      a2uiEnvelopesFromParts,
      actionToMessage,
      type A2uiClientAction,
    } from '@genkit-ai/a2ui/client';

    const agent = remoteAgent({ url: '/api/uiAgent' });
    const chat = agent.chat();

    const processor = new MessageProcessor([basicCatalog], async (action) => {
      // Send user UI interactions back to the agent as the next turn
      const turn = chat.sendStream({
        message: actionToMessage(action as unknown as A2uiClientAction),
      });
      for await (const chunk of turn.stream) {
        if (chunk.text) appendProseText(chunk.text);
        const envelopes = a2uiEnvelopesFromParts(chunk.raw.modelChunk?.content);
        if (envelopes.length > 0) processor.processMessages(envelopes);
      }
      await turn.response;
    });
    ```

=== "Flutter (Dart / genui)"

    ```dart
    import 'dart:convert';
    import 'package:a2ui_core/a2ui_core.dart' as core;
    import 'package:genkit/experimental_client.dart';
    import 'package:genkit_a2ui/client.dart';
    import 'package:genui/genui.dart' hide basicCatalogId, DataPart;

    final agent = remoteAgent(
      url: 'http://localhost:8080/api/uiAgent',
      getSnapshotUrl: 'http://localhost:8080/api/uiAgent/getSnapshot',
      abortUrl: 'http://localhost:8080/api/uiAgent/abort',
    );
    final chat = agent.chat();
    final surfaceController = SurfaceController(
      catalogs: [BasicCatalogItems.asCatalog().copyWith(catalogId: basicCatalogId)],
    );

    // Stream prose deltas and A2UI envelopes
    final turn = chat.sendStream(text: 'Book a table for 4 tomorrow evening');
    await for (final chunk in turn.stream) {
      if (chunk.text.isNotEmpty) appendProse(chunk.text);
      for (final envelope in a2uiEnvelopesFromParts(chunk.raw.modelChunk?.content)) {
        surfaceController.handleMessage(core.A2uiMessage.fromJson(envelope));
      }
    }
    await turn.response;

    // Forward surface button clicks and form submissions back to the agent
    surfaceController.onSubmit.listen((ChatMessage message) async {
      for (final part in message.parts) {
        final interaction = part.asUiInteractionPart?.interaction;
        if (interaction == null) continue;
        final decoded = jsonDecode(interaction);
        final m = (decoded is Map ? decoded['action'] : null) as Map?;
        if (m != null) {
          final action = A2uiClientAction(
            name: (m['name'] as String?) ?? 'action',
            surfaceId: (m['surfaceId'] as String?) ?? '',
            sourceComponentId: (m['widgetId'] as String?) ?? '',
            timestamp: DateTime.now().toUtc().toIso8601String(),
            context: (m['context'] as Map?)?.cast<String, dynamic>() ?? const {},
          );
          await chat.sendStream(message: actionToMessage(action));
        }
      }
    });
    ```

---

## 3. Registering Custom Catalogs

To extend or replace the built-in `basic` catalog with custom domain widgets, register a catalog in the Genkit registry using `loadCatalog` (TypeScript/Dart) or `a2uix.LoadCatalog` (Go) and reference its ID in the middleware configuration:

=== "JavaScript / TypeScript"

    ```ts
    import { loadCatalog, basicCatalog, a2ui, type A2uiCatalog } from '@genkit-ai/a2ui';

    const dashboardCatalog: A2uiCatalog = {
      id: 'https://example.com/catalogs/dashboard.json',
      components: [
        ...basicCatalog.components,
        {
          name: 'MetricCard',
          description: 'Displays a key metric with a title, numeric value, and trend indicator.',
          props: 'title: string (required); value: string|number (required); trend?: up|down|neutral.',
        },
      ],
    };

    await loadCatalog(ai, { id: 'dashboard', catalog: dashboardCatalog });

    // Attach to your agent with strict validation:
    // use: [a2ui({ catalog: 'dashboard', validate: 'strict' })]
    ```

=== "Go"

    ```go
    myCatalog := &a2uix.Catalog{
    	ID: "https://example.com/catalogs/dashboard.json",
    	Components: []a2uix.CatalogComponent{
    		{
    			Name:        "MetricCard",
    			Description: "Displays a key metric with a title, numeric value, and trend indicator.",
    			Props:       "title: string (required); value: string|number (required); trend?: up|down|neutral.",
    		},
    	},
    }
    _ = a2uix.LoadCatalog(g, myCatalog)

    // Attach to your agent or Generate call:
    // ai.WithUse(&a2uix.Surfaces{CatalogID: myCatalog.ID, Validate: "strict"})
    ```

=== "Dart"

    ```dart
    import 'package:genkit_a2ui/a2ui.dart';

    const dashboardCatalogId = 'https://example.com/catalogs/dashboard.json';

    final dashboardCatalog = A2uiCatalog(
      id: dashboardCatalogId,
      components: [
        ...basicCatalog.components,
        const A2uiCatalogComponent(
          name: 'MetricCard',
          description: 'Displays a key metric with a title, numeric value, and trend indicator.',
          props: 'title: string (required); value: string|number (required); trend?: up|down|neutral.',
        ),
      ],
    );

    await loadCatalog(ai, id: dashboardCatalogId, catalog: dashboardCatalog);

    // Attach to your agent:
    // use: [a2ui(catalog: dashboardCatalogId, validate: 'strict')]
    ```

---

## Observability with the Genkit Developer UI

Because A2UI middleware integrates directly into Genkit's execution trace, you can inspect every step of your multi-turn agent loop using the local Genkit Developer UI:

```bash
genkit start -- <your-server-command>
```

In the Developer UI, you can inspect:

- The exact catalog instructions injected into the system prompt by `a2ui()`.
- Backend tool calls and model reasoning steps.
- The structured A2UI envelopes (`createSurface`, `updateComponents`, `updateDataModel`) emitted in real time.
- Incoming `A2uiClientAction` payloads submitted from client surfaces.

---

## Official Genkit A2UI Documentation & Resources

- **[Genkit Generative UI (A2UI) Overview](https://genkit.dev/docs/agents/a2ui)**: Canonical multi-language guide covering catalogs, data binding, security trust boundaries, and streaming.
- **Language-Specific Documentation**:
    - **[JavaScript / TypeScript (`@genkit-ai/a2ui`)](https://genkit.dev/docs/js/agents/a2ui)**
    - **[Go (`github.com/firebase/genkit/go/plugins/a2ui/exp`)](https://genkit.dev/docs/go/agents/a2ui)**
    - **[Dart (`package:genkit_a2ui`)](https://genkit.dev/docs/dart/agents/a2ui)**
- **Sample Applications**:
    - **[JavaScript / TypeScript + Lit Sample](https://github.com/genkit-ai/genkit/tree/main/js/testapps/a2ui)**
    - **[Go A2UI Middleware Sample](https://github.com/genkit-ai/genkit/tree/main/go/samples/basic-middleware/a2ui)**
    - **[Dart + Flutter A2UI Testapp](https://github.com/genkit-ai/genkit-dart/tree/main/testapps/a2ui)**
    - **[Full-Stack Dining Concierge (Dart & Flutter)](https://github.com/genkit-ai/samples/tree/main/a2ui-reservations_dart)**
