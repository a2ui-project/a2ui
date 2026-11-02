---
name: a2ui-add-eval-datapoint
description: Step-by-step workflow for adding and verifying new evaluation data points in the A2UI evaluation suite, by importing a real trace or authoring a sample by hand.
---

# Adding and verifying A2UI evaluation data points

Use this skill when adding new data points or datasets to the A2UI evaluation framework in `eval/`.

## References

For full architecture and setup details, consult:

- `eval/CONTRIBUTING_USE_CASES.md`: The contributor guide for evaluation use cases, with field definitions, context rules, the `assertions` reference, example file requirements, and the unencrypted multi-turn example.
- `eval/README.md`: Evaluation quickstart, Transcrypt setup, and CLI flags.
- `eval/DESIGN.md`: Architecture, the three-stage scoring funnel, and encryption-at-rest design.
- `eval/datasets/dataset_schema.json`: Formal JSON Schema defining required fields and structural rules for evaluation data points.

---

## Step-by-step workflow

### 1. Unlock Transcrypt

Datasets in `eval/datasets/` are encrypted at rest. Every YAML file in that directory stays encrypted so that web crawlers cannot feed the prompts and rubrics into model training data. Unlock Transcrypt locally before authoring (ask an A2UI team member for the password):

```bash
cd eval
bin/transcrypt -y -c aes-256-cbc -p <PASSWORD>
```

### 2. Choose a source

Pick the path that matches what the user gave you.

If the user has a recorded session, import it with `bin/import_trace.py` (step 3a). A session can be an Inspect AI `.eval` log, a JSON array of chat messages, or an ADK/A2A event trace. This path keeps the real conversation shape and derives `assertions` from the golden payload.

If the user gave you a description, mockup, or synthetic conversation, author the entry by hand (step 3b).

### 3a. Import a real trace

Run from `eval/`. The output must be a YAML file under `datasets/`; the tool refuses any other location.

```bash
uv run ./bin/import_trace.py --input <trace> --output datasets/<dataset_name>.yaml \
  --name <sample_name> --description "<what the sample tests>" --tags <tag1,tag2>
```

Use `--dry-run` first and show the user the entry. Then write it. Other flags:

- `--sample-id` picks a sample from an `.eval` log.
- `--catalog` overrides the catalog path.
- `--dataset` overrides the dataset name.
- `--force` replaces an entry with the same name.
- `--no-sanitize` skips redaction. Use it only when the user has already redacted the trace.

After writing, open the entry and check three things. The redaction left no secrets or personal data. The `description` reads as a judging rubric, because it is also the `target`. The derived `assertions` list only what the scenario needs.

### 3b. Author the data point by hand

Create or update a dataset file in `eval/datasets/<dataset_name>.yaml` (for example `eval/datasets/my_dataset.yaml`).

Every data point **must conform** to the JSON Schema in `eval/datasets/dataset_schema.json` and follow the authoring guidelines in `eval/CONTRIBUTING_USE_CASES.md`.

For a complete unencrypted reference example of a multi-turn conversation with system instructions, tool calls (including unrelated background tool calls), tool responses, and a judging target rubric, inspect `eval/examples/example_eval_case.json`.

**Key authoring requirements from `eval/CONTRIBUTING_USE_CASES.md`:**

- Include the full multi-turn conversation history (`messages`), including assistant function calls (`tool_calls`) and tool responses (`role: tool`). Do not use single-turn prompts.
- Write the `target` as a qualitative judging rubric for the LLM-as-a-judge (what UI components must appear, data binding rules, and what errors to penalize). Do not include a hardcoded JSON string, as that ties the evaluation to a particular inference format.
- Add an `assertions` block for the checks that must hold regardless of the judge: `required_components`, `forbidden_components`, `required_bindings`, `required_actions`, `message_types`, `catalog_ids`. Keep each list short. Every key is optional.
- Use `catalogs` instead of `catalog` when the sample needs several catalogs, a pruned catalog (`allowed_components`, `allowed_functions`), or per-catalog `examples`.
- Use `initial_state` plus `allowed_messages` for a sample where the model must update an existing surface instead of creating one.
- Set `stream_chunk_size` when the sample should also verify the format's streaming parser.
- Any `examples` file should hold complete wire messages with `version`, `surfaceId` and `catalogId`.

### 4. Tag the sample

Set `tags` on every sample. Add `smoke` only when the sample should run on every pull request. The smoke tier is a small, curated set, so ask the user before adding to it.

Use other tags, such as `real`, `multi_catalog`, `pruned` or `stateful`, to describe what the sample exercises. `main.py --tags a,b` and `--tier NAME` select samples by these tags.

### 5. Optionally expand the sample into variants

Once the base sample passes, `bin/expand_cases.py` derives deterministic variants without calling a model:

```bash
uv run ./bin/expand_cases.py --input datasets/<dataset_name>.yaml \
  --output datasets/<dataset_name>_expanded.yaml \
  --mutations multi_catalog,pruned,stateful_update --names <sample_name>
```

Variants are named `<sample_name>__<mutation>` and tagged with the mutation. `pruned` needs `assertions.required_components` on the source sample. Use `--dry-run` to preview. The output must also be under `datasets/`.

### 6. Validate schema compliance

Verify that all data points satisfy `eval/datasets/dataset_schema.json`:

```bash
cd eval
uv run python -m pytest tests/test_dataset.py
```

Then confirm the loader accepts the new sample and that its tags select it:

```bash
uv run python -c "
from a2ui_eval.dataset import load_a2ui_dataset
ds = load_a2ui_dataset(dataset='<dataset_name>', tags='<tag1>')
print(len(ds), [s.metadata['name'] for s in ds])
"
```

The sample name must appear in the printed list. An empty list means the tag filter or the dataset name does not match.

### 7. Run an evaluation on the new data point

Always execute an evaluation run on the newly added dataset to verify model inference and scoring:

```bash
cd eval
# Quick validation on gemini-3.1-flash-lite
uv run main.py --dataset <dataset_name> --sanity

# Full evaluation check
uv run main.py --dataset <dataset_name>
```

Without a Gemini key, run the structural stages only with `--no-judge`. Check that Stage 1 (schema validation) and Stage 2 (your `assertions`) pass. When a reasonable model output fails Stage 2, an assertion is usually too strict.

View the interactive traces and judging rationales:

```bash
uv run inspect view start
```

### 8. Verify encryption and commit

When staging changes, Git applies the Transcrypt clean filter. Confirm that the staged file is encrypted ciphertext before committing:

```bash
# Stage the new dataset file
git add eval/datasets/my_dataset.yaml

# Verify staged content is encrypted ciphertext (not plaintext)
git diff --cached eval/datasets/my_dataset.yaml

# Commit the encrypted data point
git commit -m "feat(eval): add my_dataset evaluation data points"
```

Example payload files referenced by `examples` live outside `eval/datasets/` and are committed in plaintext, so make sure they contain nothing sensitive.
