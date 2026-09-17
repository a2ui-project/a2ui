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
    			ai.WithUse(&a2uix.Surfaces{}),
    		},
    		aix.WithSessionStore(localstore.NewInMemorySessionStore[any]()),
    	)

    	mux := http.NewServeMux()
    	mux.Handle("/api/uiAgent", genkit.Handler(uiAgent))
    	http.ListenAndServe(":8080", mux)
    }
    ```

    See the [Genkit Go A2UI Docs](https://genkit.dev/docs/go/agents/a2ui) and the [Go A2UI Sample](https://github.com/genkit-ai/genkit/tree/main/go/samples/basic-middleware/a2ui).

=== "Dart"

    Add `genkit_a2ui` alongside your core Genkit packages:

    ```bash
    dart pub add genkit genkit_a2ui genkit_google_genai genkit_shelf
    ```

    Register `A2uiPlugin()` and pass `a2ui()` in your agent's `use` list:

    ```dart
    import 'package:genkit/genkit.dart';
    import 'package:genkit_a2ui/a2ui.dart';
    import 'package:genkit_google_genai/genkit_google_genai.dart';
    import 'package:genkit_shelf/genkit_shelf.dart';
    import 'package:shelf/shelf_io.dart' as io;

    final ai = Genkit(plugins: [googleAI(), A2uiPlugin()]);

    final uiAgent = ai.defineAgent(
      name: 'uiAgent',
      model: googleAI.gemini('gemini-flash-latest'),
      system:
          'You are the dining concierge for Cymbal Bistro. Keep text responses brief.\n'
          'Use checkAvailability before rendering a reservation form card, and use '
          'confirmReservation when the user submits their booking to render a '
          'confirmation card with their confirmation code.',
      use: [a2ui()], // or pass a custom catalog: a2ui(catalog: myCatalog)
      store: InMemorySessionStore(),
    );

    void main() async {
      await io.serve(shelfHandler(uiAgent.action), 'localhost', 8080);
    }
    ```

    See the [Genkit Dart A2UI Docs](https://genkit.dev/docs/dart/agents/a2ui) and the [Full-Stack Dart & Flutter Sample](https://github.com/genkit-ai/samples/tree/main/a2ui-reservations_dart).

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
        const envelopes = a2uiEnvelopesFromParts(chunk.raw.modelChunk?.content);
        if (envelopes.length > 0) processor.processMessages(envelopes);
      }
    });
    ```

=== "Flutter (Dart / genui)"

    ```dart
    import 'package:a2ui_core/a2ui_core.dart' as core;
    import 'package:genkit/client.dart';
    import 'package:genkit_a2ui/client.dart';
    import 'package:genui/genui.dart' hide basicCatalogId, DataPart;

    final agent = remoteAgent(url: 'http://localhost:8080/api/uiAgent');
    final chat = agent.chat();
    final surfaceController = SurfaceController(
      catalogs: [BasicCatalogItems.asCatalog().copyWith(catalogId: basicCatalogId)],
    );

    // Stream prose deltas and A2UI envelopes
    final turn = chat.sendStream(text: 'Book a table for 4 tomorrow evening');
    await for (final chunk in turn.stream) {
      for (final envelope in a2uiEnvelopesFromParts(chunk.raw.modelChunk?.content)) {
        surfaceController.handleMessage(core.A2uiMessage.fromJson(envelope));
      }
    }

    // Forward surface button clicks and form submissions back to the agent
    surfaceController.onSubmit.listen((message) async {
      final action = extractClientAction(message);
      if (action != null) {
        await chat.sendStream(message: actionToMessage(action));
      }
    });
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
    - **[Full-Stack Dining Concierge (Dart & Flutter)](https://github.com/genkit-ai/samples/tree/main/a2ui-reservations_dart)**
    - **[Go A2UI Middleware Sample](https://github.com/genkit-ai/genkit/tree/main/go/samples/basic-middleware/a2ui)**
