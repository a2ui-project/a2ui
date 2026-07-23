---
name: a2ui-add-eval-datapoint
description: Step-by-step workflow for adding and verifying new evaluation data points in the A2UI evaluation suite.
---

# Adding and verifying A2UI evaluation data points

Use this skill when adding new data points or datasets to the A2UI evaluation framework in [eval/](file:///Users/jsimionato/development/a2ui_repos/datapoint/A2UI/eval).

## References

For full technical specifications, consult:
- [eval/README.md](file:///Users/jsimionato/development/a2ui_repos/datapoint/A2UI/eval/README.md): Evaluation quickstart and Transcrypt setup.
- [eval/DESIGN.md](file:///Users/jsimionato/development/a2ui_repos/datapoint/A2UI/eval/DESIGN.md): Evaluation architecture and grading details.
- [specification/proposals/eval_suite_expansion.md](file:///Users/jsimionato/development/a2ui_repos/datapoint/A2UI/specification/proposals/eval_suite_expansion.md): Full dataset schema and field reference guide.

---

## Step-by-step workflow

### 1. Unlock Transcrypt
Datasets are encrypted at rest in Git. Unlock Transcrypt locally before editing:
```bash
cd eval
bin/transcrypt -p <PASSWORD>
```

### 2. Add or update dataset YAML
Create or edit a YAML file in [eval/datasets/](file:///Users/jsimionato/development/a2ui_repos/datapoint/A2UI/eval/datasets) (e.g. `eval/datasets/my_dataset.yaml`):

```yaml
- name: sample_name
  dataset: my_dataset
  description: Brief summary of what this sample tests.
  catalog: "specification/{version}/catalogs/basic/catalog.json"
  system_prompt: "Optional domain-specific system prompt."
  messages:
    - role: user
      content: "Create a contact form..."
  target: "Expected UI outcome and rubric criteria for LLM judge."
```

### 3. Validate schema compliance
Run the automated schema test:
```bash
cd eval
uv run python -m pytest tests/test_dataset.py
```

### 4. Run an evaluation test on the new data point
Always run a test on the newly added dataset to verify model inference and scoring:
```bash
cd eval
# Quick check (flash-lite model)
uv run main.py --dataset my_dataset --sanity

# Full evaluation check
uv run main.py --dataset my_dataset
```

### 5. Inspect results and commit
Explore model outputs and validator rationales in Inspect AI's web viewer:
```bash
uv run inspect view start
```
Stage and commit changes (Git transparently encrypts YAML files via Transcrypt filters):
```bash
git add eval/datasets/my_dataset.yaml
git commit -m "feat(eval): add my_dataset evaluation data points"
```
