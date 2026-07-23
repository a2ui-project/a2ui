# A2UI Evaluation Framework

This folder contains evaluation tests (aka evals) for the A2UI project using the [Inspect AI](https://inspect.aisi.org.uk/) framework.
An evaluation test verifies that a prompt or conversational history produces expected UI results conforming to the A2UI schema and semantic rules.

## Design

For a detailed overview of the evaluation architecture, multi-stage scoring, and secret management, see [DESIGN.md](DESIGN.md).

## Datasets and Schema

Evaluation data points live in `datasets/*.yaml` files (e.g., `datasets/core_v0_9_1.yaml`, `datasets/core_v1_0.yaml`, `datasets/multi_turn_conversation_dataset.yaml`).

Every dataset file must conform to the JSON schema defined in `datasets/dataset_schema.json`.

### Dataset Structure

Each sample in a dataset YAML file defines:

- **`name`** (required): Unique identifier for the sample.
- **`description`** (required): Human-readable summary of the test scenario.
- **`catalog`** (required): Relative path to the component catalog (e.g., `"specification/{version}/catalogs/basic/catalog.json"`).
- **`dataset`** (optional): Logical dataset grouping name (defaults to file basename).
- **`system_prompt`** (optional): Domain-specific system instructions (e.g. clinical triage rules or travel policies).
- **`messages`** (required): Chat conversation turns (`user`, `assistant` with optional `tool_calls`, `tool` returns, and `system`).
- **`target`** (optional): Expected UI outcome description and grading criteria for the LLM judge.

## Running Evaluations

Make sure you are in the `eval/` directory.

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

To test across different inference formats (`direct` JSON, `express` XML tags, `elemental` DSL):

```bash
uv run main.py --dataset multi_turn_conversation_dataset --strategies direct,express,elemental
```

For a quick 2-sample validation using `gemini-3.1-flash-lite`:

```bash
uv run main.py --sanity
```

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
