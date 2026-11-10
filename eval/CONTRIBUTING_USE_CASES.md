# Contributing evaluation use cases

This guide explains how application teams can contribute evaluation use cases (data points) to the A2UI evaluation framework without needing to understand the evaluation engine or solvers.

There are two ways to add a use case. The fastest is to capture a real agent session with `bin/import_trace.py`. The other is to write the data point by hand or with the `a2ui-add-eval-datapoint` skill. Both end in the same place: a YAML entry under `eval/datasets/` that conforms to `eval/datasets/dataset_schema.json`.

## Why full conversation context is required

A2UI is an agent-driven UI protocol where components render dynamically based on conversation state, retrieved data, and domain rules. Single-turn prompts are insufficient for evaluating agent behavior.

A complete evaluation use case requires the full conversational context:

- **System prompt (`system_prompt`)**: Domain-specific instructions, application personas, clinical triage rules, or business policies.
- **Conversation history (`messages`)**: The complete dialogue sequence leading up to the final UI generation request. All conversation turns (`user`, `assistant`) and tool call interactions (`tool_calls`, `tool` returns) must be interleaved in chronological order within this single `messages` list so the model sees the exact sequence of operations.
- **Tool call history (`tool_calls` and `tool` roles)**: Within the interleaved `messages` list, include all assistant function calls and tool return payloads, including unrelated tool calls or extra background context. Production conversations are noisy. Testing with the same noise shows whether the agent still reasons correctly when extra context could confuse it.
- **Expected output description (`target`)**: A qualitative rubric for the LLM-as-a-judge. Do not include a hardcoded JSON string, as that ties the evaluation to a particular inference format (such as JSON vs. XML or DSL). Instead, describe which UI components must appear, how data binding should be wired, and what errors should be penalized.

## Capturing a real session with `import_trace.py`

`bin/import_trace.py` converts a recorded agent session into a dataset entry. Run it from the `eval/` directory. It reads three input formats and detects which one it has from the file:

- An Inspect AI `.eval` log. One sample is imported; `--sample-id` picks it, and the default is the first.
- A JSON array of chat messages in OpenAI or Inspect style (`role`, `content`, `tool_calls`, `tool_call_id`), optionally wrapped as `{"messages": [...]}`.
- An ADK or A2A event trace: a JSON array (or `{"events": [...]}`) of events with `author` or `role` and `content.parts[]` carrying `text`, `functionCall` or `functionResponse` parts.

```bash
cd eval
uv run ./bin/import_trace.py --input ~/traces/booking.json \
  --output datasets/real_world_v1_0.yaml \
  --name booking_confirmation_card \
  --description "Renders a confirmation card for the booked flight" \
  --tags real,smoke
```

The tool does the following:

1. Moves the system message into `system_prompt`.
2. Finds the golden assistant turn: the last assistant message holding an `<a2ui-json>` or `<a2ui>` block. It cuts the conversation after the final user turn before that message, so the model under test must produce the payload itself.
3. Redacts secrets and personal data from every string. Pass `--no-sanitize` only when you have already cleaned the trace yourself.
4. Derives Stage 2 `assertions` from the golden payload when it is Direct JSON.
5. Validates the entry against `dataset_schema.json` and appends it to the output file.

Other flags:

- `--dry-run` prints the entry instead of writing it.
- `--force` replaces an entry with the same `name`.
- `--dataset` overrides the dataset name. The default is the output file's stem.
- `--catalog` sets a catalog path relative to the repository root. The default is `specification/{version}/catalogs/basic/catalog.json`.

The output path must be under `eval/datasets/`. The tool refuses to write a YAML file anywhere else inside the repository, because only that directory is encrypted.

After importing, open the entry and review it. Check that the redaction caught everything. Check that the `description` is a rubric the judge can grade against, since it doubles as `target`. Check that the derived `assertions` state what the scenario needs, not everything the golden payload happened to contain.

## Creating representative synthetic data from production logs

If you cannot share a real trace even after redaction, base a synthetic scenario on it so the length, structure, and complexity reflect actual usage. Evaluation datasets must never contain confidential information, personally identifiable information (PII), or proprietary business data.

While the Contributor License Agreement (CLA) covers legal redistribution rights, it is your responsibility as a contributor to audit every data point before submission to verify that all content is free of confidential data, PII, or proprietary information and is appropriate for public release.

### Recommended anonymization workflow

1. **Inspect production logs**: Review a real conversation to understand its number of turns, tool call patterns, argument complexity, and any unrelated background context.
2. **Draft a structural specification**: Write a detailed description of the conversation without including any real customer data or confidential values. Mention every user message, assistant turn, and tool call, noting the dialogue length, data types, and structural complexity.
3. **Generate synthetic data from the specification**: Ask a language model to generate a synthetic conversation that matches your structural specification. Because the specification contains no confidential data, the resulting synthetic dialogue will be clean.
4. **Audit the output**: Review the generated data point to confirm that no sensitive details remain and that the synthetic scenario reproduces the reasoning challenge from the original log.

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

For an unencrypted reference example of a multi-turn evaluation data point, see `eval/examples/example_eval_case.json`. It shows a complete scenario with domain system instructions, multiple tool calls (including an unrelated weather lookup), tool return payloads, a UI generation request, and a qualitative judging rubric. A continuous integration test verifies that this example file conforms to `eval/datasets/dataset_schema.json`.

## Data point format reference

Every data point is a YAML object inside a list in `eval/datasets/<dataset_name>.yaml` and must conform to `eval/datasets/dataset_schema.json`.

Core fields:

- `name` (required, string): Unique identifier for the sample (lowercase with underscores).
- `description` (required, string): A concise summary of what the scenario tests.
- `catalog` (string): Repo-relative path to the component catalog. Use `'catalogs/basic/v1/catalog.json'` for standard v1.0 components; older versions live at `'specification/{version}/catalogs/basic/catalog.json'`. Either `catalog` or `catalogs` is required.
- `messages` (required, array): Ordered list of conversation turns (`user`, `assistant` with optional `tool_calls`, `tool` with `tool_call_id`, and `system`).
- `system_prompt` (optional, string): Domain-specific system instructions.
- `target` (optional, string): Grading rubric for the LLM-as-a-judge. Defaults to `description` if omitted.
- `dataset` (optional, string): Logical dataset name. Defaults to the filename if omitted.
- `tags` (optional, array of strings): Free-form tags that `main.py --tags` and `--tier` select on. Tag a sample `smoke` only if it should run on every pull request.

Inference-layer fields:

- `catalogs` (array): Use instead of `catalog` to give the model several catalogs, to prune a catalog, or to attach per-catalog examples. Each entry has `path` (required), `catalog_id`, `allowed_components`, `allowed_functions` and `examples`. The first entry is the default catalog.
- `examples` (array of paths): Files holding few-shot example payloads for the single `catalog`. Inside a `catalogs[]` entry, `examples` applies to that catalog.
- `allowed_messages` (array): The message types the model may write, from `createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface`. Omit to allow all of them.
- `initial_state` (array of A2UI messages): Applied to a fresh renderer state before the model's turn is validated. Use it for scenarios where the model must update an existing surface rather than create one.
- `stream_chunk_size` (integer, at least 1): When set, the runner also feeds the completion through the format's streaming parser in slices of this many characters. It fails if the two parses disagree.
- `assertions` (object): Deterministic Stage 2 checks, described next.

## Writing `assertions`

`assertions` are checked by code, not by the judge, and run before the judge. A sample that fails an assertion is graded incorrect without a judge call. Use them for the things the scenario cannot do without. Leave softer expectations, such as layout choices or wording, to the `target` rubric.

```yaml
assertions:
  required_components: [Card, Button]
  forbidden_components: [TextField]
  required_bindings: [/booking/selectedFlight]
  required_actions: [confirmBooking]
  message_types: [createSurface]
  catalog_ids: [https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json]
```

| Key                    | Meaning                                               |
| :--------------------- | :---------------------------------------------------- |
| `required_components`  | Component types that must appear at least once.       |
| `forbidden_components` | Component types that must not appear.                 |
| `required_actions`     | Action event names that some component must dispatch. |
| `required_bindings`    | Data model paths that must be bound or written.       |
| `message_types`        | The only message types the payload may contain.       |
| `catalog_ids`          | Catalog ids that some surface or component must name. |

Every key is optional, and an empty list asserts nothing. Keep the lists short. An assertion that lists ten components turns a semantic test into a brittle snapshot. Component names must match the catalog exactly, including case.

## Example payload files

The `examples` fields point at JSON files that hold few-shot example payloads, shown to the model in the prompt. Each file holds a JSON array of messages, or an object with a `messages` array. Every message should be a complete wire message with `version`, `surfaceId` and `catalogId` set.

Example files are plain JSON and are not encrypted. Do not put anything in them that you would not put in a public README.

## Generating variants with `expand_cases.py`

Once a sample passes, `bin/expand_cases.py` can derive harder variants from it without calling a model:

```bash
cd eval
uv run ./bin/expand_cases.py --input datasets/core_v1_0.yaml \
  --output datasets/expanded_v1_0.yaml \
  --mutations multi_catalog,pruned,stateful_update --names booking_confirmation_card
```

Each variant is named `<name>__<mutation>` and tagged with the mutation. `multi_catalog` adds the MCP app catalog as a second catalog. `pruned` limits the catalog to `assertions.required_components` plus the layout set (`Column`, `Row`, `Card`, `Text`, `Button`), so it needs `required_components`.

`stateful_update` seeds `initial_state` with a surface, appends a follow-up user turn, and limits `allowed_messages` to updates. Like `import_trace.py`, it writes only under `eval/datasets/`.

## Working with dataset encryption

Evaluation datasets in `eval/datasets/*.yaml` are encrypted at rest using Transcrypt. Public repositories are crawled for training data. If prompts and rubrics were stored in plaintext, future models could learn them and the benchmark would stop measuring anything.

For that reason every dataset YAML stays encrypted, including files that `import_trace.py` and `expand_cases.py` write. The only plaintext sample is `eval/examples/example_eval_case.json`.

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
   If you tagged the sample `smoke`, also confirm it is selected: `uv run main.py --dataset <dataset_name> --tier smoke --limit 1`.
3. Inspect the execution trace and scoring:
   ```bash
   uv run inspect view start
   ```
   Open `http://localhost:7575` in your browser to inspect conversation turns, the Stage 2 assertion results, and the judge's rationale.
