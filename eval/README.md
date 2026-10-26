# A2UI Evaluation Framework

This folder contains evaluation tests (evals) for the A2UI project, built on the [Inspect AI](https://inspect.aisi.org.uk/) framework.
An eval checks that a prompt or conversation history produces a UI payload that follows the A2UI schema and the semantic rules of the scenario.

## Design

For the evaluation architecture, the three-stage scoring funnel, and secret management, see [DESIGN.md](DESIGN.md).

## Contributing Use Cases & Datasets

To contribute evaluation use cases or datasets, read [CONTRIBUTING_USE_CASES.md](CONTRIBUTING_USE_CASES.md). It explains:

- How to import a real agent session with `bin/import_trace.py`.
- How to use the `a2ui-add-eval-datapoint` skill to convert your data into the dataset format.
- Why full multi-turn conversation context (including unrelated tool calls) is required.
- How to write deterministic `assertions` and few-shot example files.
- Where to view an unencrypted multi-turn example (`examples/example_eval_case.json`).
- How to work with Transcrypt encryption when creating or editing files.

Evaluation data points live in `datasets/*.yaml` files and must conform to the JSON schema in `datasets/dataset_schema.json`. Every YAML file under `datasets/` stays encrypted in Git. See [Dataset encryption](#dataset-encryption) below.

## Running Evaluations

Make sure your working directory is `eval/`.

### Prerequisites

1. **Set your Gemini API key**:

   ```bash
   export GEMINI_API_KEY="your_api_key"
   ```

2. **Decrypt Datasets (First Time Setup)**:
   The evaluation datasets are encrypted at rest in the repository to prevent base model contamination. To decrypt them locally, initialize Transcrypt with the shared password:

   ```bash
   bin/transcrypt -p <PASSWORD>
   ```

   After this setup, git transparently encrypts files on `git add` and decrypts them on checkout.

### Upgrading Transcrypt

If you pull updates that change the encryption settings (such as transitioning from MD5 to PBKDF2), you may encounter decryption errors during `git pull` or see OpenSSL deprecation warnings.

To upgrade your local Transcrypt configuration to the latest settings:

1. Run the upgrade command:

   ```bash
   bin/transcrypt --upgrade
   ```

   This updates the local filter scripts in your `.git` directory while preserving your saved password.

2. Force Git to re-decrypt the files:

   ```bash
   git checkout HEAD -- $(git ls-crypt)
   ```

   This runs the files through the newly upgraded smudge filter, decrypting them.

### Executing Evals

To run all datasets:

```bash
uv run main.py
```

To run a specific dataset or multiple datasets:

```bash
# Run a single dataset
uv run main.py --dataset multi_turn_conversation_dataset

# Run multiple datasets
uv run main.py --datasets core_v0_9_1,multi_turn_conversation_dataset
```

By default `main.py` runs the production strategies: `direct`, `subagent_tool` and `express`. The experimental formats `elemental` and `atom`, and the `skill_mode` strategy, run only when you name them:

```bash
uv run main.py --dataset multi_turn_conversation_dataset --strategies direct,express,elemental
uv run main.py --strategies skill_mode
```

The `subagent_tool` strategy gives the outer model one tool, `a2ui_specialist`, and a second model call writes the payload. `--subagent-format {direct_json,express}` picks the format the specialist writes in (default `direct_json`).

The `skill_mode` strategy does not put the A2UI prompt in the system message. It lists the available skills (`a2ui-core` plus one per catalog) and gives the model a `read_a2ui_skill` tool to load them. The skills the model read are recorded as `skills_read` in the sample metadata.

For a quick 2-sample validation using `gemini-3.1-flash-lite`:

```bash
uv run main.py --sanity
```

### Profiles

`--profile` sets a group of concurrency and judge defaults in one flag. Any flag you pass explicitly overrides the profile.

| Profile   | Settings                                                        | Use it for                                   |
| :-------- | :-------------------------------------------------------------- | :------------------------------------------- |
| `cloud`   | `--max-samples 10`, `--working-limit 350`, judge on             | Hosted APIs such as Gemini                   |
| `local`   | `--max-samples 1`, `--max-connections 2`, `--working-limit 900` | A model served on your own machine           |
| `offline` | Same as `local` plus `--no-judge`                               | A local model with no Gemini key for judging |

The individual flags are `--max-samples N` (concurrent samples), `--max-connections N` (concurrent model connections), `--working-limit SECONDS` (time budget per sample), `--no-judge` and `--model-base-url URL`.

### The smoke tier

Samples carry free-form `tags`. `--tags a,b` keeps only the samples that carry at least one of the listed tags. `--tier NAME` is an alias for `--tags NAME`. The curated subset for fast checks is tagged `smoke`:

```bash
uv run main.py --tier smoke
uv run main.py --tags smoke,stateful
```

`bin/run_ci_evals.py` forwards `--tier` and `--tags` to `main.py`.

### Pass@1 and Pass@K

By default a sample gets one attempt. With `--max-validation-retries N`, a completion that fails strict validation is sent back to the model with the validation error, up to `N` more times. The log then carries two outcomes per sample:

- `pass_at_1`: the first completion validated.
- `pass_at_k`: some completion within the retry budget validated.

`validation_retries_used` records how many retries a sample needed. The `subagent_tool` strategy records the same information for the specialist call as `subagent_pass_at_1` and `subagent_validation_retries_used`. The default is `0`, so CI reports Pass@1 unless `run_ci_evals.py` is given `--max-validation-retries`.

```bash
uv run main.py --strategies express --max-validation-retries 2
```

### Skipping the judge

`--no-judge` disables the Stage 3 LLM judge. A sample that passes Stage 1 (schema validation) and Stage 2 (deterministic assertions) is graded `C`; a sample that fails either stage is graded `I`. Use it when you have no Gemini key, or when you only want to measure structural validity:

```bash
uv run main.py --model ollama/gemma4:e4b --strategies express --no-judge
```

### Choosing the Protocol Version

`--version` selects the A2UI protocol version: `0.9.1`, `1.0` or `auto` (the default). A leading `v`, as in `v1.0`, is also accepted.

With `auto`, a dataset whose name ends in a version suffix runs under that version: `core_v0_9_1` runs under 0.9.1 and `core_v1_0` under 1.0. Datasets without a suffix run under 1.0, except with the `subagent_tool` strategy, which runs under 0.9.1. When `--datasets` lists datasets for both versions, each version gets its own task.

```bash
# Run every dataset that supports v0.9.1
uv run main.py --version 0.9.1

# Run each core dataset under its own version
uv run main.py --datasets core_v0_9_1,core_v1_0 --strategies direct
```

An explicit `--version` that conflicts with a requested dataset is an error. For example, `--version 0.9.1 --dataset core_v1_0` fails instead of running an empty dataset.

The eval report (`bin/report_evals.py`) shows the protocol version and strategy of each run.

### Running Other Model Providers

`--model` takes any Inspect AI model name. The prefix selects the provider:

| Prefix                          | Provider                                            | Credentials           |
| :------------------------------ | :-------------------------------------------------- | :-------------------- |
| `google/`                       | Gemini API (default)                                | `GEMINI_API_KEY`      |
| `openai/`                       | OpenAI                                              | `OPENAI_API_KEY`      |
| `anthropic/`                    | Anthropic                                           | `ANTHROPIC_API_KEY`   |
| `openrouter/`                   | OpenRouter                                          | `OPENROUTER_API_KEY`  |
| `ollama/`                       | Local Ollama server                                 | none                  |
| `vllm/`                         | Local vLLM server                                   | none                  |
| `openai-api/<provider>/<model>` | Any OpenAI-compatible server (llama.cpp, LM Studio) | depends on the server |

The Anthropic and Mistral client libraries are optional. Install them with:

```bash
uv sync --extra frontier
```

Only Gemini models run in CI. Run other cloud providers on demand:

```bash
uv run main.py --model openai/gpt-5 --profile cloud --tier smoke
uv run main.py --model anthropic/claude-sonnet-4-5 --profile cloud --tier smoke
```

The judge still defaults to `google/gemini-3.6-flash`, so keep `GEMINI_API_KEY` set unless you pass `--no-judge`.

### Running Local Models (Ollama, vLLM, llama.cpp)

Local servers handle far fewer concurrent requests than a hosted API. Use `--profile local` (or `--profile offline` when you have no Gemini key) so Inspect does not flood the server.

Ollama:

```bash
ollama serve
ollama pull gemma4:e4b
uv run main.py --model ollama/gemma4:e4b --strategies express --profile local --tier smoke
```

vLLM, with the server already running:

```bash
uv run main.py --model vllm/google/gemma-4-31b-it --strategies express --profile local \
  --model-base-url http://localhost:8000/v1
```

llama.cpp or LM Studio, through the OpenAI-compatible provider:

```bash
uv run main.py --model openai-api/llamacpp/gemma-4-e4b-it --strategies express --profile offline \
  --model-base-url http://localhost:8080/v1
```

`--model-base-url` points Inspect at a server other than the provider default.

#### Gemma aliases

`main.py` accepts short aliases for the Gemma models used in the mobile and edge experiments:

| Alias                        | Resolves to                 | Notes                                               |
| :--------------------------- | :-------------------------- | :-------------------------------------------------- |
| `gemma`, `gemma-4-26b`       | `google/gemma-4-26b-a4b-it` | Cloud. 26B total, 4B active parameters.             |
| `gemma-large`, `gemma-4-31b` | `google/gemma-4-31b-it`     | Cloud. 31B dense.                                   |
| `gemma-e2b`, `gemma4:e2b`    | `ollama/gemma4:e2b`         | Local. Sized for standard smartphones (about 6 GB). |
| `gemma-e4b`, `gemma4:e4b`    | `ollama/gemma4:e4b`         | Local. Sized for flagship smartphones (about 8 GB). |
| `gemma-2b`, `gemma2:2b`      | `ollama/gemma2:2b`          | Local. 2B parameters.                               |

```bash
uv run main.py --model gemma --strategies express
uv run main.py --model gemma-e2b --strategies express --dataset core_v1_0 --limit 3 --profile local
```

> [!IMPORTANT]
> Gemma models must never be used as the judge (`--grading-model`). The grading model defaults to a Gemini Flash model (`google/gemini-3.6-flash` or `google/gemini-3.1-flash-lite`) and must stay one, so that grades are comparable across runs.

## How a sample is scored

Scoring is a gated funnel. A sample must pass each stage to reach the next:

1. Stage 1, schema validation. The Python evaluation runner parses the completion and runs strict validation against the active catalogs. When the solver already compiled the payload, the scorer reuses `metadata["compiled_messages"]` instead of parsing again.
2. Stage 2, deterministic assertions. The sample's `assertions` block is checked against the compiled messages. A sample without `assertions` passes this stage.
3. Stage 3, LLM judge. `measured_model_graded_qa` asks the grading model for a grade of `C` (correct), `P` (partial) or `I` (incorrect) against the sample's `target`. The judge is skipped when Stage 1 or 2 failed (grade `I`) or when `--no-judge` is set (grade `C`).

`bin/report_evals.py` counts a sample as passed only when Stage 1 and 2 passed and the judge returned `C`. This is the number the CI threshold is applied to. For logs written before Stage 2 existed, the report falls back to the accuracy metric of the first scorer.

## Dataset fields

Each sample in `datasets/*.yaml` is a YAML object. Beyond `name`, `description`, `messages`, `system_prompt` and `target` (see [CONTRIBUTING_USE_CASES.md](CONTRIBUTING_USE_CASES.md) for the full list), these fields control the inference layer:

| Field               | Purpose                                                                                                                                                      |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog`           | Path to one catalog JSON file, relative to the repository root. Supports `{version}`. Either `catalog` or `catalogs` is required.                            |
| `catalogs`          | A list of catalogs, in order; the first is the default. Each entry has `path`, optional `catalog_id`, `allowed_components`, `allowed_functions`, `examples`. |
| `examples`          | Paths of JSON files holding few-shot example payloads for the single `catalog`. Inside `catalogs[]`, `examples` applies to that catalog.                     |
| `allowed_messages`  | Message types the model may write: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`. Omit to allow all.                               |
| `initial_state`     | A2UI messages applied to a fresh renderer state before the model's turn is validated, so the turn can update an existing surface.                            |
| `stream_chunk_size` | When set, the runner also feeds the completion through the format's streaming parser in slices of this many characters and fails on a mismatch.              |
| `tags`              | Free-form tags for `--tags` and `--tier`, such as `smoke`, `multi_catalog`, `pruned` or `stateful`.                                                          |
| `assertions`        | Stage 2 checks: `required_components`, `forbidden_components`, `required_bindings`, `required_actions`, `message_types`, `catalog_ids`.                      |

`allowed_components` and `allowed_functions` prune the catalog before the prompt is built, so the model sees only the listed names. Example payload files hold wire messages with `version`, `surfaceId` and `catalogId`.

## Importing a real trace

`bin/import_trace.py` turns a recorded agent session into a dataset entry. It accepts an Inspect `.eval` log, a JSON array of chat messages, or an ADK/A2A event trace, and detects the format from the file.

```bash
uv run ./bin/import_trace.py --input trace.json --output datasets/real_world_v1_0.yaml \
  --name booking_confirmation --tags smoke,real --description "Confirms a booking in a card"
```

The tool cuts the conversation after the final user turn before the golden A2UI payload. It redacts secrets and personal data (skip with `--no-sanitize`). When the golden payload is Direct JSON, it derives `assertions` from it.

`--dry-run` prints the entry instead of writing it. `--force` replaces an entry with the same name. The output must be under `datasets/`; the tool refuses to write YAML anywhere else in the repository.

## Expanding cases

`bin/expand_cases.py` writes deterministic variants of existing samples without calling a model. Each variant is named `<name>__<mutation>` and tagged with the mutation name.

```bash
uv run ./bin/expand_cases.py --input datasets/core_v1_0.yaml --output datasets/expanded_v1_0.yaml \
  --mutations multi_catalog,pruned,stateful_update
```

- `multi_catalog` makes the sample's catalog the first of two `catalogs`; the second is the MCP app catalog for the sample's protocol version.
- `pruned` limits the primary catalog to `assertions.required_components` plus `Column`, `Row`, `Card`, `Text` and `Button`. Samples without `required_components` are skipped.
- `stateful_update` seeds `initial_state` with a surface, adds a follow-up user turn, and limits `allowed_messages` to `updateComponents` and `updateDataModel`.

`--names a,b` limits the expansion to the named samples. Like `import_trace.py`, this tool writes only under `datasets/`.

## Dataset encryption

Every YAML file under `datasets/` is encrypted with Transcrypt before it reaches Git, including files written by `import_trace.py` and `expand_cases.py`. Public repositories are crawled for training data. If prompts and rubrics were stored in plaintext, future models could learn them and the benchmark would stop measuring anything.

Contributors get the password on request from an A2UI team member. The schema (`dataset_schema.json`) and `examples/example_eval_case.json` are not encrypted.

## Viewing Evaluation Results

Inspect AI provides a web-based log viewer to explore interactive traces and judge rationales:

```bash
uv run inspect view start
```

This starts a local web server (usually at `http://localhost:7575`).

To print a console summary or markdown table from an eval log file:

```bash
uv run python bin/report_evals.py logs/<log_filename>.eval
```

## Running Unit Tests & Schema Validation

To run the unit tests and validate all dataset files against `datasets/dataset_schema.json`:

```bash
uv run python -m pytest
```

## Iterative Format Optimization Framework

For benchmarking, testing, and optimizing alternative A2UI inference formats (Atom, Express, Elemental), see the [Iterative Format Optimization Guide](iterative_format_optimizer/skills/inference-format-optimizer/SKILL.md).
