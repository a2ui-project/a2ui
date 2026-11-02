# e2e test

Tests that checks the following entities work well together:

1. Flutter restaurant finder client
2. Python restaurant finder agent
3. AI model

This tests are in separate package and
run in a separate CI/CD pipeline, because they
require API key.

A test that calls the model directly is skipped, with a warning, when the
model stays unavailable through every retry: the API key is out of quota
(HTTP 429) or the model is overloaded (HTTP 503). That says nothing about the
code under test, so it does not fail the run.
