---
name: a2ui-generate-catalog-patterns
description: >-
  Prepares any custom A2UI catalog (in this repository or an external
  repository) for decision-model synthesis by inspecting catalog.json and
  generating and validating patterns.json, templates.json, and
  sample_payloads.json in the catalog's directory. Use when onboarding a custom
  catalog to the decision route, updating catalog pattern or template sidecars,
  or checking archetype and template coverage.
---

# Generate Catalog Patterns and Templates for A2UI Decision Synthesis

This skill prepares any A2UI component catalog (`catalog.json`) for the decision-model synthesis pipeline (`a2ui.inference_formats.decision`). It works on catalogs inside this repository (such as `catalogs/basic/v1/catalog.json`) as well as custom catalogs in external repositories, emitting the required sidecar files directly alongside `catalog.json` (or into `--out-dir`).

Depending on the catalog's structure, the workflow generates and validates one or both sidecar files plus a required sample payload verification bundle:

1. `patterns.json`: Maps the 19 layout grammar blocks (`page` plus the 19 content blocks in `archetypes.json`) onto the catalog's composable container and leaf components for Stage 2A archetype composition.
2. `templates.json`: Registers deterministic `SurfaceTemplate` definitions for monolithic fixed-surface or domain-card components for Stage 1 template synthesis.
3. `sample_payloads.json`: Representative JSON payloads required by the validator to verify runtime archetype eligibility and template matching.

Read [references/patterns_authoring_guide.md](references/patterns_authoring_guide.md) before authoring or editing `patterns.json`, `templates.json`, or `sample_payloads.json`.

## End-to-End Workflow

### Step 1: Inspect the Target Catalog

Run [scripts/catalog_patterns_tool.py](scripts/catalog_patterns_tool.py) `inspect` on the target `catalog.json` path:

```bash
uv run python .agents/skills/a2ui-generate-catalog-patterns/scripts/catalog_patterns_tool.py \
  inspect <path/to/catalog.json> \
  --format markdown
```

Pass `--out-dir <dir>` if the generated sidecar files should be written to a directory other than the parent directory of `catalog.json`.

The inspection report classifies the catalog into one of three synthesis modes and lists `target_dir` and `recommended_files`:

- `composable`: The catalog has at least one multi-child container component (`children` slot) and no monolithic multi-field action cards. Generate `<target_dir>/patterns.json` and `<target_dir>/sample_payloads.json`.
- `fixed_surface`: The catalog has no multi-child container (for example, a catalog of three fixed domain forms). Archetype composition cannot assemble pages without a container; generate `<target_dir>/templates.json` and `<target_dir>/sample_payloads.json`.
- `hybrid`: The catalog has both multi-child containers and monolithic multi-field domain components with action slots. Generate both `<target_dir>/patterns.json` and `<target_dir>/templates.json`, plus `<target_dir>/sample_payloads.json`.

### Step 2: Author `patterns.json` and/or `templates.json` in `target_dir`

Follow the mode reported by `inspect`:

#### When `mode` is `composable` or `hybrid`: Author `<target_dir>/patterns.json`

Use the **Component Inventory**, **Page Container Candidates**, and **19 Grammar Block Contracts** tables from the inspection report, along with [references/patterns_authoring_guide.md](references/patterns_authoring_guide.md):

1. Set `"$schema": "https://a2ui.org/specification/v1_0/decision/pattern_definition.json"`, `"catalogIds": ["<catalog_id>"]`, and `"version": "1"`.
2. Author `"page"` first using the top candidate in `page_candidates` (such as `Column` or `Stack`). Include `"title"`, `"subtitle"`, `"mark"`, and `{"$blocks": true}` in its children list.
3. Author the foundational content patterns in priority order:
   - `headline`, `facts`, `prose`, `picture`, `collection`, `actions`, `form`
   - Any additional blocks from the 19 grammar blocks that have matching components in the catalog (`banner`, `filters`, `media`, `chart`, `comparison`, `steps`, `groups`, `timeline`, `map`, `conversation`, `compose`, `outcome`).
4. When a specialized block (such as `chart`, `timeline`, `map`, `banner`, `outcome`, `steps`, `comparison`, `groups`, or `conversation`) has no dedicated component in the catalog, either omit that pattern so `resolve_fallback_pattern` uses its fallback chain (`headline`, `facts`, `prose`, `collection:rows`, `form`, or `steps`), or author a capability substitution using the catalog's primitives.

#### When `mode` is `fixed_surface` or `hybrid`: Author `<target_dir>/templates.json`

Use the **Fixed-Surface Template Candidates** table from the inspection report and the `templates.json` section of [references/patterns_authoring_guide.md](references/patterns_authoring_guide.md):

1. Set `"version": "1.0"`, `"catalogId": "<catalog_id>"`, and `"protocolVersion"` matching the catalog (`"1.0"` or `"0.9"`).
2. For each `TemplateCandidate`, add an entry under `"templates"` keyed by `suggested_template_id`:
   - Set `"requiredPointers"` to the candidate's `suggested_required_pointers` (or the domain pointers that uniquely identify when this surface applies).
   - Set `"isMutable": true` when the template collects user input or triggers a state-changing action.
   - Define `"components"` with `"id": "root"` on the root component, binding each required data property to its JSON pointer (`{"@path": "/..."}` for `1.0`, `{"path": "/..."}` for `0.9`) and each action property to `{"event": {"name": "..."}}`.

### Step 3: Prepare `<target_dir>/sample_payloads.json`

Payload validation is mandatory. If the user supplied sample payloads, place or reference them at `<target_dir>/sample_payloads.json`. Otherwise, author `<target_dir>/sample_payloads.json` with a `"samples"` map containing representative domain payloads:

- For `patterns.json`, include payloads whose pointer shapes exercise the catalog's target task families (for example, an array of 3+ homogeneous item objects for `browse`, numeric metrics for `monitor`, and mutable fields for `input`).
- For `templates.json`, include at least one sample payload per registered `SurfaceTemplate` that populates all of that template's `requiredPointers` with valid sample values.

### Step 4: Validate Patterns, Templates, and Sample Payloads

Run `validate` with `--catalog` and `--payload`:

```bash
uv run python .agents/skills/a2ui-generate-catalog-patterns/scripts/catalog_patterns_tool.py \
  validate \
  --catalog <path/to/catalog.json> \
  --payload <target_dir>/sample_payloads.json \
  --format markdown
```

By default, `validate` auto-discovers `<target_dir>/patterns.json` and `<target_dir>/templates.json` next to `catalog.json` (or in `--out-dir`). You can also pass explicit `--patterns <path>` and/or `--templates <path>` flags, and `--strict` to fail if `patterns.json` defines pattern names outside `{page} | set(grammar.blocks)`.

The validator checks four stages and exits `0` only when every stage passes:

- `expand`: Dry-runs `PatternExpander.expand_page` and `PatternExpander.expand_block` across every knob combination of every pattern and fallback block.
- `lint`: Runs `lint_components` on every expanded pattern surface and every `SurfaceTemplate`.
- `schema`: Validates every expanded pattern surface and every rendered `SurfaceTemplate` message batch (`createSurface`, `updateComponents`, `updateDataModel`) against the catalog's JSON Schema via `validate_payload`.
- `payload`: Runs `eligible_archetypes` and `TemplateRegistry.matching_templates` across every sample in `--payload`, failing if `patterns.json` yields zero eligible archetypes or if any `SurfaceTemplate` in `templates.json` matches zero sample payloads.

If `validate` reports any failures, fix the offending pattern, template, or sample payload and re-run `validate` until `Overall OK: True` (exit code `0`).

### Step 5: Sync Bundled Assets (Only for `catalogs/basic/v1`)

If the target catalog is `catalogs/basic/v1/catalog.json` inside this repository, synchronize `catalogs/basic/v1/patterns.json` into the Python package asset directory:

```bash
uv run python python/a2ui_agent/scripts/sync_decision_assets.py
```

### Step 6: Report Coverage and Runtime Wiring

Present the validation summary to the user (eligible archetypes, degraded fallback blocks, validated templates, and per-sample eligibility) along with the Python snippet to load the generated files from the catalog directory at runtime:

```python
import json
from pathlib import Path
from a2ui.core import Catalog
from a2ui.inference_formats.decision import (
    CatalogDecisionGraph,
    DecisionSynthesizer,
    MergedPatternLibrary,
    PatternLibrary,
    TemplateRegistry,
)

catalog_dir = Path("<target_dir>")
catalog = Catalog.from_json(json.loads((catalog_dir / "catalog.json").read_text()))
graph = CatalogDecisionGraph([catalog])

# Load patterns.json when present (composable or hybrid catalogs):
pattern_lib = MergedPatternLibrary([PatternLibrary.from_file(catalog_dir)])

# Load templates.json when present (fixed_surface or hybrid catalogs):
template_registry = TemplateRegistry.from_file(catalog_dir)

synthesizer = DecisionSynthesizer(
    graph,
    backend,
    registry=template_registry,
    patterns=pattern_lib,
)
```
