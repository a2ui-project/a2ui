# A2UI Flutter example

A chat app in which a Gemini model answers with text and A2UI surfaces, on
protocol v0.9. It runs on macOS and the web.

## Running

With a [Gemini API key](https://aistudio.google.com/app/apikey) in
`GEMINI_API_KEY`:

```bash
flutter run -d macos --dart-define=GEMINI_API_KEY=$GEMINI_API_KEY
flutter run -d chrome --dart-define=GEMINI_API_KEY=$GEMINI_API_KEY
```

Without the key, the app says how to pass it. Then ask for some UI, such as
"Show a newsletter sign-up form with an email field and a Subscribe button",
fill it in and press its button.

## What it demonstrates

[lib/chat_session.dart](lib/chat_session.dart) runs the loop between
`a2ui_agent`, `a2ui_core` and `a2ui_flutter`:

1. The renderer's capabilities name the basic catalog. `A2uiGenerator`
   negotiates the basic catalog from them, in the direct JSON format, and the
   system prompt is the app's instructions followed by its prompt snippet.
2. The model's reply streams through the direct JSON `Parser.parseChunk`,
   in [lib/reply_reader.dart](lib/reply_reader.dart). Text shows in the
   chat, and messages go to the app's `MessageProcessor`, so a surface
   renders while the model writes it. `ReplyReader` gives the parser each
   `updateComponents` as it streams, and every other message only once its
   object closes. Given part of one, the parser would send a `createSurface`
   again as it grows, and a partial `updateDataModel` would replace or delete
   data ([a2ui#NNNN](https://github.com/a2ui-project/a2ui/issues/NNNN)).
3. Each surface renders in the chat in an `A2uiSurface`, with the Markdown
   in its Text rendered by `flutter_markdown_plus`.
4. An event action on a surface goes back to the model as the next user turn:
   the v0.9 `action` message, with the client data model of each surface
   created with `sendDataModel`. The model answers with text, updates to the surface
   or new surfaces.
5. Errors go back the same way, as v0.9 `error` messages: those a surface
   reports to `onError`, messages the `MessageProcessor` rejects, and blocks
   the parser rejects, each with the id of the surface whose message failed
   when there is one. The rest of a reply after a rejected block is still
   read. At most two turns of errors in a row go back before the user's next
   turn.

The model sits behind the `LlmClient` interface in
[lib/llm_client.dart](lib/llm_client.dart), which `GeminiClient` implements
with `dartantic_ai`.

## Tests

- `test/recorded_turn_test.dart` replays a reply `gemini-3.6-flash` streamed
  for a newsletter form, types an email address into the form and presses
  its button. It checks the action and data model the model receives, and
  the surface the model's recorded answer leaves.
- `test/chat_session_test.dart` covers a `createSurface` that grows across
  chunks, an `updateDataModel` cut across chunks, messages the
  `MessageProcessor` and the parser reject, an error the model repeats, a
  request that fails or gives no reply, disposal, and the client data model
  sent after a typed turn.
- `test/reply_reader_test.dart` covers how `ReplyReader` reads on after a
  block the parser rejects and holds an `updateDataModel` back until its
  object closes.
- [../e2e_test](../e2e_test) runs the app against the live model. It needs
  an API key, so it lives in a separate package and runs in a separate CI
  pipeline.
