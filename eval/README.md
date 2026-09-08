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

### Running Evaluations on Gemma Models (Express Format)

Gemma models can be evaluated either through **Google AI Studio / Gemini API cloud services** (no local GPU required) or **locally via Ollama** on a machine with a dedicated GPU.

> [!NOTE]
> Gemma evaluations do not run by default or as part of CI workflows. CI evaluations continue to use `google/gemini-3.5-flash`.

#### Required API Keys

Regardless of whether inference runs in the cloud or via Ollama, evaluation grading uses Gemini Flash as the LLM-as-a-judge. Set your Google Gemini API key:

```bash
export GEMINI_API_KEY="your_api_key_here"
```

You can obtain an API key from [Google AI Studio](https://aistudio.google.com/).

#### Option A: Cloud Execution (Google AI Studio / Gemini API)

- **Mobile / On-Device Tier (`--gemma` or `--gemma mobile` or `--model gemma-4-26b`)**:
  `google/gemma-4-26b-a4b-it` — A Mixture-of-Experts model with 26B total parameters and **4B active parameters** (`a4b`), representative of the class of lightweight models feasible for execution on modern mobile hardware.
- **Large / Workstation Tier (`--gemma large` or `--model gemma-4-31b`)**:
  `google/gemma-4-31b-it` — A 31B dense parameter model offering higher reasoning capacity.

```bash
# Run Gemma 4 mobile tier on Express format (default strategy for --gemma is express)
uv run main.py --gemma

# Run Gemma 4 large tier (31B) on Express format
uv run main.py --gemma large

# Run on a specific dataset or limit sample count for quick checks
uv run main.py --gemma --dataset core_v1_0 --limit 3
```

#### Option B: Local / Edge Execution via Ollama (GPU-Accelerated)

For smaller edge-optimized models that can run fully offline on standard or flagship smartphones (requiring 6–8 GB RAM):

- **Gemma 4 E2B (`--gemma e2b` or `--model gemma-e2b`)**:
  `ollama/gemma4:e2b` — Edge model designed for standard smartphones (~6 GB RAM offline).
- **Gemma 4 E4B (`--gemma e4b` or `--model gemma-e4b`)**:
  `ollama/gemma4:e4b` — Edge model designed for recent flagship smartphones (~8 GB RAM offline).
- **Gemma 2 2B (`--gemma 2b` or `--model gemma-2b`)**:
  `ollama/gemma2:2b` — Lightweight 2B parameter open model.

**Prerequisites**:

1. Install [Ollama](https://ollama.com/) and start the daemon:
   ```bash
   ollama serve
   ```
2. Pull the target model(s):
   ```bash
   ollama pull gemma4:e2b
   ollama pull gemma4:e4b
   ```
3. Run the evaluation against your local Ollama instance:

   ```bash
   # Run Gemma 4 E2B via Ollama
   uv run main.py --gemma e2b --dataset core_v1_0 --limit 3

   # Run Gemma 4 E4B via Ollama
   uv run main.py --gemma e4b --dataset core_v1_0 --limit 3
   ```

> [!IMPORTANT]
> **LLM-as-a-Judge Rule**: Gemma models must **never** be used as the evaluation grader (`--grading-model`). The grading model defaults to and must remain a Gemini Flash model (e.g. `google/gemini-3.5-flash` or `google/gemini-3.1-flash-lite`) to ensure consistent, unbiased grading. Ensure `GEMINI_API_KEY` is set when running Ollama evaluations.

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
