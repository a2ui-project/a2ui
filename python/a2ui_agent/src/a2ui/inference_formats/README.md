# A2UI Inference Formats

This directory contains inference format implementations (`direct_json`, `express`, `elemental`, `atom`, `decision`) for the A2UI Python SDK.

## Overview

An inference format defines how an agent emits UI definitions. A2UI supports both generative routes where a language model writes DSL or JSON code, and a decision-model synthesis route that compiles structured data into valid UI surfaces using a trained classifier or cross-encoder.

## The Decision Synthesis Route

The `decision` route separates data from interface design: the agent supplies an intent and the data, and a decision model chooses a layout from the catalog's patterns. The format is experimental and supports protocol v1.0 only. It runs in tool mode or chat mode.

Every entry point takes an explicit decision backend. `create_decision_backend()` builds one from the environment and raises `ValueError` when `A2UI_DECISION_BACKEND` is unset.

### 1. Tool Mode (Direct Synthesis)

In tool mode, an agent calls its normal domain tools, and their output goes straight to `DecisionRenderTool` or `DecisionSynthesizer.synthesize`. The language model never writes UI.

```python
from a2ui.inference_formats.decision import (
    DecisionRenderTool,
    create_decision_backend,
)

render_tool = DecisionRenderTool.create(catalogs, backend=create_decision_backend())

result = render_tool.run_sync({
    "intent": "Show host health status",
    "payload": {"host": "prod-01", "cpu": 0.94, "status": "critical"},
    "actions": {"restart_host": {"label": "Restart", "style": "destructive"}},
})
```

### 2. Chat Mode (Decision Blocks)

In chat mode, the language model writes a decision block inside `<a2ui>` tags and `DecisionParser` renders it. A block has these fields:

- `intent` and `payload` (required).
- `surfaceId`: a new id creates a surface; reusing an id updates that surface in place.
- `replace`: when `true`, the surface is deleted and created again.
- `region`: block role name of one planned block to re-plan and update in place on an existing surface.
- `actions`: a map from action id to a label or an options object (`label`, `scope`, `key`, `context`, `style`). The id is the event name the agent receives.
- `exclude`: payload pointers the surface must not show.
- `labels`: display label overrides keyed by `/`-prefixed JSON Pointer.
- `mutablePaths`: payload pointers the user may edit. Forms and settings must list them.
- `layout`, `title`, `summary`, and `fallbackDsl`.

```python
from a2ui.inference_formats.decision import DecisionBlock, DecisionSynthesizer

block = DecisionBlock(
    intent="Show stock portfolio overview",
    payload={"portfolio": "Growth", "totalValue": 128450.0},
    title="Portfolio Summary",
)
output = await synthesizer.synthesize(
    block.intent, block.payload, **block.to_synthesis_kwargs(default_surface_id="turn-1")
)
```

### 3. How a Surface Is Planned

Each surface takes one `answer()` call to the backend (two for backends that declare `capabilities.two_stage`). When a registered template matches the payload, the batch includes a template question, and a confident answer renders that template. Otherwise the planner picks a layout archetype and expands its blocks from the catalog's patterns.

When the model abstains, the synthesizer tries, in order, the block's `fallbackDsl`, the host's `fallback_fn`, and one `facts` pattern rendering of the payload. If none applies, it raises `A2uiCompilationError`. `SynthesisOutput.fallback_source` and `fallback_reason` record what happened. A backend timeout or transport failure raises `DecisionBackendError` and no fallback runs.

### 4. Surfaces Across Turns

`DecisionParser` reads the `RendererState` before synthesis. A block for a surface the client already shows replaces the surface root in place (`updateComponents` with stable per-block component ids, plus `updateDataModel`), and `replace: true` sends `deleteSurface` before creating it again. An update whose actions need `sendDataModel` on a surface created without it becomes a replace. Without a bound state, `DecisionFormat.create_parser(conversation_id=...)` keeps one state per conversation.

### 5. Custom Catalogs (`patterns.json` and `templates.json`)

Custom catalogs can ship `patterns.json` and `templates.json` alongside `catalog.json`. A `patterns.json` names one `catalogId` and the `grammarVersion` it was written for. A catalog with templates but no patterns can still render through the template question.

To onboard any custom `catalog.json` (in this repository or an external repository) to the decision synthesis route, use the [a2ui-generate-catalog-patterns](../../../../../.agents/skills/a2ui-generate-catalog-patterns/SKILL.md) skill and its helper CLI (`catalog_patterns_tool.py`). Depending on whether the catalog provides composable containers, fixed domain surfaces, or both, the skill generates and validates `patterns.json`, `templates.json`, and `sample_payloads.json` alongside `catalog.json`.

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

catalog_dir = Path("/path/to/custom_catalog")
catalog = Catalog.from_json(json.loads((catalog_dir / "catalog.json").read_text()))

synthesizer = DecisionSynthesizer(
    CatalogDecisionGraph([catalog]),
    backend,
    registry=TemplateRegistry.from_file(catalog_dir),
    patterns=MergedPatternLibrary([PatternLibrary.from_file(catalog_dir)]),
)
```

## Backend Configuration

| Backend     | Setup                                                               | Characteristics                                                                              |
| :---------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------- |
| `systemone` | Set `A2UI_DECISION_URL` and `JEV_API_KEY` (or `A2UI_DECISION_AUTH`) | Hosted or local `/v1/systemone` decision API over HTTP.                                      |
| `jev`       | Set `JEV_API_KEY` or `TYPESAFE_API_KEY`, or `A2UI_DECISION_URL`     | TypeSafe Jev, pinned to `jev-1.14.0` by default.                                             |
| `gemini`    | Set `GEMINI_API_KEY` or `GOOGLE_API_KEY`, or `A2UI_DECISION_URL`    | Google Gemini Decisions API (`/v1beta/decisions`), pinned to `gemini-decision-1` by default. |
| `step0`     | Set `A2UI_DECISION_URL`                                             | Step-zero logprob scorer; asks questions in two stages.                                      |
| `mock`      | Set `A2UI_DECISION_BACKEND=mock`                                    | Deterministic offline backend for tests.                                                     |

### Environment Variables

- `A2UI_DECISION_BACKEND`: `systemone`, `jev`, `gemini`, `step0`, or `mock`. Required unless a backend is passed in code.
- `A2UI_DECISION_URL`: Endpoint URL for remote HTTP backends.
- `A2UI_DECISION_MODEL` / `JEV_MODEL` / `GEMINI_DECISION_MODEL`: Model id overrides.
- `A2UI_DECISION_AUTH` / `A2UI_DECISION_TOKEN` / `JEV_API_KEY` / `TYPESAFE_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY`: Authentication for remote backends.

Each backend applies a per-model `Calibration` (temperature scaling) from a bundled profile, or from a file passed as `calibration=`. HTTP requests time out after 30 seconds unless `timeout_seconds` says otherwise.

### Operational Notes

- **Payload Privacy**: Remote backends receive pointer paths, labels, and sample scalar values from the payload. Use `exclude` or filter the payload before sending secrets to a third-party endpoint.
- **Payload Size**: The planner caps a batch at `SynthesisConfig.max_pairs` (question and option pairs, default 400). For payloads with hundreds of keys, pass only the fields the surface needs.

## Catalog-Agnostic Prompt Generation Rules

To ensure long-term maintainability, portability, and catalog independence:

1. **Single Source of Truth**:
   All component signatures, parameter descriptions, function helpers, and property constraints are derived dynamically from the `Catalog` JSON schema via schema helpers (`CatalogSchemaHelper`).

2. **No Hardcoded Catalog String Hacks**:
   Prompt generators (`PromptGenerator` implementations) do not hardcode catalog-specific string replacements, regular expression filters, or custom text manipulations to modify component or property descriptions at runtime.

3. **Schema First**:
   If a component parameter description or constraint needs adjustment, update the catalog JSON schema file (`specification/<version>/catalogs/basic/catalog.json`) directly, rather than patching prompt generator logic.

4. **Independent Grammar Contracts**:
   Format-level grammar rules define the output syntax structure and do not contradict property guidelines defined in the catalog JSON schema.
