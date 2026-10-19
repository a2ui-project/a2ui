# A2UI Flutter example

A chat app in which a Gemini model answers with text and A2UI surfaces, on
protocol v1.0. It runs on macOS and the web.

## Running

With a [Gemini API key](https://aistudio.google.com/app/apikey) in
`GEMINI_API_KEY`:

```bash
flutter run -d macos --dart-define=GEMINI_API_KEY=$GEMINI_API_KEY
flutter run -d chrome --dart-define=GEMINI_API_KEY=$GEMINI_API_KEY
```

The key is compiled into the app, so keep builds that carry it on your own
machine. The app also gives the basic catalog `launchUrl` as its `openUrl`
callback, so a button the model writes can open a link.

Without the key, the app says how to pass it. Then ask for some UI, such as
"Show a newsletter sign-up form with an email field and a Subscribe button",
fill it in and press its button.

## What it demonstrates

[lib/chat_session.dart](lib/chat_session.dart) runs the loop between
`a2ui_agent`, `a2ui_core` and `a2ui_flutter`:

1. The app advertises the basic catalog. `A2uiGenerator` builds the matching
   direct JSON prompt, after the app's own instructions.
2. The model's reply streams through the direct JSON `Parser.parseChunk`.
   Text shows in the chat, and messages go to the app's `MessageProcessor`,
   so a surface renders while the model writes it.
3. Each surface renders in the chat in an `A2uiSurface`, with the Markdown
   in its Text rendered by `flutter_markdown_plus`.
4. An event action on a surface goes back to the model as the next user turn:
   the v1.0 `action` message, with the client data model of each surface
   created with `sendDataModel`. The model answers with text, updates to the
   surface or new surfaces.
5. Errors go back the same way, as v1.0 `error` messages, each with the id
   of the surface whose message failed when there is one:
   - errors a surface reports to `onError`
   - messages the `MessageProcessor` rejects
   - blocks the parser rejects

   The rest of a reply after a rejected block is not read. At most two turns
   of errors in a row go back before the user's next turn.

The model sits behind the `LlmClient` interface in
[lib/llm_client.dart](lib/llm_client.dart), which `GeminiClient` implements
with `dartantic_ai`.

## Tests

- `test/recorded_turn_test.dart` replays a model's streamed reply for a
  newsletter form, types an email address into the form and presses
  its button. It checks the action and data model the model receives, and
  the surface the model's recorded answer leaves.
- `test/chat_session_test.dart` covers a `createSurface` that grows across
  chunks, messages the `MessageProcessor` and the parser reject, an error the
  model repeats, a request that fails or gives no reply, disposal, and the
  client data model sent after a typed turn.
- [../e2e_test](../e2e_test) runs the app against the live model. It needs
  an API key, so it lives in a separate package and runs in a separate CI
  pipeline.
