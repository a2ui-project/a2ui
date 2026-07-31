# Contributing evaluation use cases

This guide explains how application teams can contribute evaluation use cases (data points) to the A2UI evaluation framework without needing to understand the underlying evaluation engine or solvers.

## Why full conversation context is required

A2UI is an agent-driven UI protocol where components render dynamically based on conversation state, retrieved data, and domain rules. Single-turn prompts are insufficient for evaluating agent behavior.

A complete evaluation use case requires the full conversational context:

- **System prompt (`system_prompt`)**: Domain-specific instructions, application personas, clinical triage rules, or business policies.
- **Conversation history (`messages`)**: The complete dialogue sequence leading up to the final UI generation request. All conversation turns (`user`, `assistant`) and tool call interactions (`tool_calls`, `tool` returns) must be properly interleaved in chronological order within this single `messages` list so the model sees the exact sequence of operations.
- **Tool call history (`tool_calls` and `tool` roles)**: Within the interleaved `messages` list, include all assistant function calls and tool return payloads—including unrelated tool calls or extra background context. Testing models with realistic, noisy conversation histories verifies that the agent can still reason accurately in the presence of potentially confusing extra context, representing real production usage.
- **Expected output description (`target`)**: A qualitative rubric for the LLM-as-a-judge. Do not include a hardcoded JSON string, as that ties the evaluation to a particular inference format (such as JSON vs. XML or DSL). Instead, describe which UI components must appear, how data binding should be wired, and what errors should be penalized.

## Creating representative synthetic data from production logs

To contribute an effective evaluation data point, base your scenario on real production logs so the length, structure, and complexity reflect actual usage. However, evaluation datasets must never contain confidential information, personally identifiable information (PII), or proprietary business data.

While the Contributor License Agreement (CLA) covers legal redistribution rights, it is your responsibility as a contributor to personally audit every data point before submission to verify that all content is free of confidential data, PII, or proprietary information and is appropriate for public release.

### Recommended anonymization workflow

1. **Inspect production logs**: Review a real conversation to understand its number of turns, tool call patterns, argument complexity, and any unrelated background context.
2. **Draft a structural specification**: Write a detailed description of the conversation without including any real customer data or confidential values. Mention every user message, assistant turn, and tool call, noting the dialogue length, data types, and structural complexity.
3. **Generate synthetic data from the specification**: Ask a language model to generate a completely synthetic conversation that matches your structural specification. Because the specification contains no confidential data, the resulting synthetic dialogue will be clean.
4. **Audit the output**: Personally review the generated data point to confirm that no sensitive details remain and that the synthetic scenario accurately reproduces the reasoning challenge from the original log.

## Authoring workflow using the AI skill

Instead of writing dataset files by hand, use the `a2ui-add-eval-datapoint` AI skill (`.agents/skills/a2ui-add-eval-datapoint/SKILL.md`). This skill instructs your AI coding assistant to convert raw logs, mockups, or natural language descriptions into schema-compliant dataset files.

1. Unlock Transcrypt locally so your repository can read and write encrypted dataset files:
   ```bash
   cd eval
   bin/transcrypt -p <PASSWORD>
   ```
2. Invoke your AI agent, referencing the skill and your conversation data:

   ```text
   Please use the a2ui-add-eval-datapoint skill to add new multi-turn evaluation samples to eval/datasets/flight_booking.yaml.

   System prompt:
   "You are a corporate travel assistant. Always present flight options clearly with pricing and carrier information."

   Conversation history:
   1. User asks for SFO weather and flights from SFO to JFK for October 12.
   2. Assistant calls get_weather(city="SFO") and search_flights(origin="SFO", destination="JFK", date="2026-10-12").
   3. Weather tool returns Sunny, 68F. Flight tool returns UA100 ($450) and DL200 ($520).
   4. User asks to display the available flights in an interactive card.

   Target rubric:
   The assistant must render a Card containing a list of the two flights with price and departure time, data-bound to a selection variable. The agent must ignore the unrelated weather response.
   ```

3. The agent will author the dataset entry, run schema validation (`pytest tests/test_dataset.py`), run a quick evaluation check (`main.py --sanity`), and confirm that the file is encrypted before staging.

## Unencrypted multi-turn reference example

Because files in `eval/datasets/*.yaml` are stored as encrypted ciphertext in Git, you cannot see unencrypted examples when browsing `eval/datasets/` online.

For an unencrypted reference example of a multi-turn evaluation data point, see `eval/examples/example_eval_case.json`. It shows a complete scenario with domain system instructions, multiple tool calls (including an unrelated weather lookup), tool return payloads, a UI generation request, and a qualitative judging rubric. A continuous integration test automatically verifies that this example file conforms to `eval/datasets/dataset_schema.json`.

## Data point format reference

Every data point is a YAML object inside a list in `eval/datasets/<dataset_name>.yaml` and must conform to `eval/datasets/dataset_schema.json`.

- `name` (required, string): Unique identifier for the sample (lowercase with underscores).
- `description` (required, string): A concise summary of what the scenario tests.
- `catalog` (required, string): Relative path to the component catalog. Use `'specification/{version}/catalogs/basic/catalog.json'` for standard components.
- `messages` (required, array): Ordered list of conversation turns (`user`, `assistant` with optional `tool_calls`, `tool` with `tool_call_id`, and `system`).
- `system_prompt` (optional, string): Domain-specific system instructions.
- `target` (optional, string): Grading rubric for the LLM-as-a-judge. Defaults to `description` if omitted.
- `dataset` (optional, string): Logical dataset name. Defaults to the filename if omitted.

## Working with dataset encryption

Evaluation datasets in `eval/datasets/*.yaml` are encrypted at rest using Transcrypt to prevent external LLM training crawlers from indexing evaluation prompts and contaminating benchmark results.

- Before authoring or reading dataset files, unlock Transcrypt (ask an A2UI team member for the password):
  ```bash
  cd eval
  bin/transcrypt -p <PASSWORD>
  ```
- Once unlocked, Git transparently decrypts `.yaml` files on checkout and encrypts them when staging changes.
- Before committing, verify that your staged file is encrypted ciphertext by running `git diff --cached eval/datasets/<file>.yaml`.

## Testing your contribution

Before submitting a pull request, validate your new data points:

1. Validate schema compliance across all dataset files:
   ```bash
   cd eval
   uv run python -m pytest tests/test_dataset.py
   ```
2. Run a sanity check on your dataset:
   ```bash
   export GEMINI_API_KEY="your_api_key"
   uv run main.py --dataset <dataset_name> --sanity
   ```
3. Inspect the execution trace and scoring:
   ```bash
   uv run inspect view start
   ```
   Open `http://localhost:7575` in your browser to inspect conversation turns and scoring rationales.
