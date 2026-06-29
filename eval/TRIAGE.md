# Triaging A2UI evaluation failures

This guide helps oncall engineers diagnose and resolve failures in the A2UI evaluation suite.

## General triage workflow

When the A2UI Evals workflow fails in GitHub Actions:

1.  **Identify the failing tasks**: Open the workflow run logs and scroll to the **Run Evals** step. Look for the list of tasks and identify which ones have a status of `FAIL`.
2.  **Determine the failure type**: For each failing task, check the **Failure Details** section in the log. Failures are classified into two types:
    - **Algorithmic Failure**: The generated UI payload failed schema validation or structural integrity checks.
    - **Judging Failure**: The LLM-as-a-judge graded the response as `I` (Incorrect) or `P` (Partial Credit) based on task-specific criteria.
3.  **Reproduce and inspect locally**: Since CI does not upload the detailed log files, you must run the evals locally to reproduce the failure and generate the logs for inspection:
    - Ensure your `GEMINI_API_KEY` is set in your environment.
    - Run the specific failing task to reproduce the issue:

      ```bash
      cd eval
      # Run a specific task (recommended for speed)
      uv run main.py --prompt=clientSideValidation

      # Or run the entire suite
      uv run main.py
      ```

    - Start the local Inspect AI log viewer to examine the full interaction history, including the system prompt, model output, and validation errors:
      ```bash
      uv run inspect view start
      ```
      Navigate to `http://localhost:7575` in your browser.

## Common failure categories

### 1. Schema validation errors (algorithmic)

These occur when the generated JSON does not conform to the JSON schemas.

- **Missing required fields**: Look for errors like `Field required` or `is a required property`.
- **Extra fields**: Look for `Additional properties are not allowed` or `Unevaluated properties are not allowed`. This often happens when the model uses properties from a different version of the protocol or catalog.
- **Type mismatches**: Look for `is not of type 'string'` or similar.

### 2. Integrity and topology errors (algorithmic)

These are evaluated by the Python SDK validator after schema validation passes.

- **Missing root component**: The component list must contain a component with `id: "root"` (or the custom root ID specified in the message).
- **Dangling references**: A component references a child ID that does not exist in the component list.
- **Circular references**: A component contains a reference that cycles back to itself (e.g., `A -> B -> A`), which would cause infinite layout recursion.

### 3. Structural/logical mismatches (judging)

These occur when the model generates valid A2UI JSON, but it does not match the requirements of the prompt.

- **Wrong component types**: The prompt requested a `List` but the model used a `Column`.
- **Missing components**: The prompt requested a title and three buttons, but the model omitted the buttons.
- **Incorrect nesting**: Components are not nested in the correct parent-child hierarchy.

---

## Case studies of recent failures

### Case study 1: URI resolution mismatch

- **Issues**: #1789, #1784
- **Symptom**: Multiple tasks fail algorithmically with `Unresolvable: catalog.json#/$defs/anyFunction`.
- **Root Cause**: A mismatch between the physical version directory (e.g., `v0_9_1`) and the logical URI namespace (`v0_9`). The `common_types.json` file in `v0_9_1` had an `$id` containing `v0_9`. When resolving the relative reference `catalog.json` from within `common_types.json`, the validator resolved it to `v0_9/catalog.json`, which was not registered in the validator's registry when running `v0_9_1` evaluations.
- **Resolution**: The `CatalogSchemaValidator` was updated to dynamically resolve and register the catalog schema under the URI relative to the `$id` of the loaded `common_types.json` schema, bridging the physical directory structure and the logical namespace.

### Case study 2: Invalid `$ref` pointers in custom catalogs

- **Issue**: #1772
- **Symptom**: Custom catalog components fail validation with `Additional properties are not allowed ('id' was unexpected)`.
- **Root Cause**: The custom catalog schema defined component schemas with invalid `$ref` paths (e.g., pointing to `#/$defs/ComponentName` instead of `#/components/ComponentName`). Because of the broken references, the validator failed to apply the base `ComponentCommon` schema, meaning the `id` property was treated as an unexpected additional property.
- **Resolution**: Corrected the `$ref` paths in the custom catalog schema to point to `#/components/` instead of `#/$defs/`.

### Case study 3: Model tag omission

- **Issue**: #1784 (specifically for `rizzCharts` and `mcpAppProxy` tasks)
- **Symptom**: `A2UI tags '<a2ui-json>' and '</a2ui-json>' not found in response`.
- **Root Cause**: The model failed to output the JSON payload within the required XML tags, instead outputting conversational text, ASCII art, or an error message about service issues.
- **Resolution**: This is usually a model capability or context window issue. If it happens consistently, check if the system prompt is too long, or if the task requires a more specific template example to guide the model.
