# A2UI Evaluation Framework

This folder contains evaluation tests (aka evals) for the A2UI project.
An evaluation test verifies that a prompt produces expected results conforming to the A2UI schema and semantic rules.

## Design

For a detailed overview of the design, secrets management, and contamination prevention, see the [DESIGN.md](DESIGN.md) file.

## Running Evaluations

To run the evaluations, you need to use the Inspect AI CLI via `uv`. Make sure you are in this directory (`evals/eval`).

### Prerequisites

1. **Set your Gemini API key**:

   ```bash
   export GEMINI_API_KEY="your_api_key"
   ```

2. **Decrypt Datasets (First Time Setup)**:
   The evaluation datasets are encrypted at rest in the repository to prevent base model contamination. To decrypt them in your repo for evaluation, you need to initialize Transcrypt with the shared password. From the `evals/eval` directory, run:

   ```bash
   bin/transcrypt -p <PASSWORD>
   ```

You can request the password from any member of the A2UI team (it's not really a secret, but it's also not going on Github in plaintext).

After this one time setup, you will have local plaintext access to the decrypted datasets in the `datasets/` directory, and they will be encrypted and decrypted transparently by git.

## Dimensions

Evaluations run across the following dimensions:

- Strategies: Different ways of orchestrating A2UI generation
- Samples: Data in `dataset/`

### Run Evals

To run the evaluations:

```bash
uv run main.py
```

For a quick 2-sample validation using `gemini-3.1-flash-lite`, use the sanity flag:

```bash
uv run main.py --sanity
```

## Viewing Evaluation Results

Inspect AI provides a web-based log viewer to explore the results of your evaluations.

To start the log viewer:

```bash
uv run inspect view start
```

This will start a local web server (usually at `http://localhost:7575`) and open the viewer in your browser. It will automatically load logs from the `logs/` directory.

## Listing Available Models

To list the available Gemini models supported by your API key:

```bash
uv run inspect eval tasks.py -T list_models=True --model google/gemini-3-flash-preview
```

(the `--model` flag is required even though it is ignored)

## Running Unit Tests

To run the unit tests for the evaluation framework (dataset loader, solvers, scorers):

```bash
uv run python -m pytest
```
