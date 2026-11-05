# e2e test

Tests that the following entities work well together:

1. `a2ui_agent`, generating UI in the direct JSON and Express formats, and
   reading direct JSON as it streams
2. `a2ui_core`, accepting the generated messages as a renderer would
3. AI model

This test is in a separate package and runs in a separate CI/CD pipeline,
because it requires an API key. To run it locally:

```bash
export GEMINI_API_KEY=your_api_key
dart test
```

A test that calls the model is skipped, with a warning, when the
model stays unavailable through every retry: the API key is out of quota
(HTTP 429) or the model is overloaded (HTTP 503). That says nothing about the
code under test, so it does not fail the run.
