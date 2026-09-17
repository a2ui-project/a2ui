# Integration tests

Renders canned A2UI samples through `ChatScreen` with a `FakeAiClient` — no API key.

From `examples/simple_chat`:

```bash
flutter pub get
flutter test integration_test/app_test.dart -d macos
```

Swap `macos` for any device from `flutter devices`. `flutter pub get` is
required first; without it you'll see a misleading `'../pubspec.yaml'` error
from the pub-workspace lookup.
