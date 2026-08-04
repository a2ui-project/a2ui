# A2UI Evaluation Framework

This folder contains evaluation tests (aka evals) for the A2UI project using the [Inspect AI](https://inspect.aisi.org.uk/) framework.
An evaluation test verifies that a prompt or conversational history produces expected UI results conforming to the A2UI schema and semantic rules.

## Design

For a detailed overview of the evaluation architecture, multi-stage scoring, and secret management, see [DESIGN.md](DESIGN.md).

## Contributing Use Cases & Datasets

To contribute evaluation use cases or datasets, read [CONTRIBUTING_USE_CASES.md](CONTRIBUTING_USE_CASES.md). It explains:

- How to use the `a2ui-add-eval-datapoint` skill to automatically convert your data into the dataset format.
- Why full multi-turn conversation context (including unrelated tool calls) is required.
- Where to view unencrypted multi-turn examples (`examples/example_eval_case.json`).
- How to work with Transcrypt encryption when creating or editing files.

Evaluation data points live in `datasets/*.yaml` files and must conform to the JSON schema defined in `datasets/dataset_schema.json`.

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

## Iterative Format Optimization Framework

For benchmarking, testing, and optimizing alternative A2UI inference formats (Atom, Express, Elemental), see the [Iterative Format Optimization Guide](iterative_format_optimizer/skills/inference-format-optimizer/SKILL.md).
