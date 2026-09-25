# e2e test

Tests that the following entities work well together:

1. `a2ui_agent`, generating UI in the Express format
2. `a2ui_core`, accepting the generated messages as a renderer would
3. AI model

This test is in a separate package and runs in a separate CI/CD pipeline,
because it requires an API key. To run it locally:

```bash
export GEMINI_API_KEY=your_api_key
dart test
```
