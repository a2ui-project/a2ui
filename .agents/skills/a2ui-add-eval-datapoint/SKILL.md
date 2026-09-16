---
name: a2ui-add-eval-datapoint
description: Step-by-step workflow for adding and verifying new evaluation data points in the A2UI evaluation suite.
---

# Adding and verifying A2UI evaluation data points

Use this skill when adding new data points or datasets to the A2UI evaluation framework in `eval/`.

## References

For full architecture and setup details, consult:

- `eval/CONTRIBUTING_USE_CASES.md`: The authoritative contributor guide for evaluation use cases, containing field definitions, context rules, and unencrypted multi-turn examples.
- `eval/README.md`: Evaluation quickstart, Transcrypt setup, and CLI flags.
- `eval/DESIGN.md`: Architecture, multi-stage scorers, and encryption-at-rest design.
- `eval/datasets/dataset_schema.json`: Formal JSON Schema defining required fields and structural rules for evaluation data points.

---

## Step-by-step workflow

### 1. Unlock Transcrypt

Datasets in `eval/datasets/` are encrypted at rest. Unlock Transcrypt locally before authoring (ask an A2UI team member for the password):

```bash
cd eval
bin/transcrypt -y -c aes-256-cbc -p <PASSWORD>
```

### 2. Author the data point

Create or update a dataset file in `eval/datasets/<dataset_name>.yaml` (e.g. `eval/datasets/my_dataset.yaml`).

Every data point **must conform** to the JSON Schema in `eval/datasets/dataset_schema.json` and follow the authoring guidelines in `eval/CONTRIBUTING_USE_CASES.md`.

For a complete unencrypted reference example of a multi-turn conversation with system instructions, tool calls (including unrelated background tool calls), tool responses, and a judging target rubric, inspect `eval/examples/example_eval_case.json`.

**Key authoring requirements from `eval/CONTRIBUTING_USE_CASES.md`:**

- Include the full multi-turn conversation history (`messages`), including assistant function calls (`tool_calls`) and tool responses (`role: tool`). Do not use single-turn prompts.
- Write the `target` as a qualitative judging rubric for the LLM-as-a-judge (what UI components must appear, data binding rules, and what errors to penalize). Do not include a hardcoded JSON string, as that ties the evaluation to a particular inference format.

### 3. Validate schema compliance

Verify that all data points satisfy `eval/datasets/dataset_schema.json`:

```bash
cd eval
uv run python -m pytest tests/test_dataset.py
```

### 4. Run an evaluation on the new data point

Always execute an evaluation run on the newly added dataset to verify model inference and scoring:

```bash
cd eval
# Quick validation on gemini-3.1-flash-lite
uv run main.py --dataset my_dataset --sanity

# Full evaluation check
uv run main.py --dataset my_dataset
```

View the interactive traces and judging rationales:

```bash
uv run inspect view start
```

### 5. Verify encryption and commit

When staging changes, Git applies the Transcrypt clean filter. Confirm that the staged file is encrypted ciphertext before committing:

```bash
# Stage the new dataset file
git add eval/datasets/my_dataset.yaml

# Verify staged content is encrypted ciphertext (not plaintext)
git diff --cached eval/datasets/my_dataset.yaml

# Commit the encrypted data point
git commit -m "feat(eval): add my_dataset evaluation data points"
```
