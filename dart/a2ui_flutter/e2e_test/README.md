# e2e test

Tests that the following entities work well together, on A2UI protocol v0.9:

1. `a2ui_agent`, prompting a model for the basic catalog and reading its
   direct JSON reply as it streams
2. `a2ui_core`, processing the messages as a renderer
3. `a2ui_flutter`, rendering the surfaces in the [example](../example) chat
   app, which sends actions and errors back to the model
4. AI model

The tests ask for a login form, fill it in and press its button, and ask for
a price and a date formatted with the basic catalog's functions. They fail on
any error a surface reports and on any message the renderer rejects.

This test is in a separate package and runs in a separate CI/CD pipeline,
because it requires an API key. To run it locally:

```bash
export GEMINI_API_KEY=your_api_key
flutter test
```
