# A2UI Inference Formats

This directory contains inference format implementations (`direct_json`, `express`, `elemental`, `atom`, `decision`) for the A2UI Python SDK.

## Overview

An inference format defines how an agent emits UI definitions. A2UI supports both generative routes where a language model writes DSL or JSON code, and a decision-model synthesis route that compiles structured data into valid UI surfaces using a trained classifier or cross-encoder.

## The Decision Synthesis Route

The `decision` route separates data generation from interface design. It supports two primary execution workflows: tool mode and chat mode.

### 1. Tool Mode (Direct Synthesis)

Tool mode is the most efficient way to render user interfaces in A2UI. In this flow, an agent calls standard domain tools (such as fetching server telemetry, retrieving catalog items, or getting a transfer quote). Instead of prompting a language model to author UI code from that tool output, the data passes directly to `DecisionRenderTool` or `DecisionSynthesizer.synthesize`.

```python
from a2ui.inference_formats.decision import DecisionRenderTool

# Provide the tool to your agent framework (e.g. ADK):
render_tool = DecisionRenderTool(catalogs=catalogs)

# When an ADK tool produces data, render it directly:
result = render_tool.call(
    intent="Show host health status",
    payload={"host": "prod-01", "cpu": 0.94, "status": "critical"},
    mutable_paths=["/status"],
)
```

Key benefits of tool mode:
- **Zero UI model calls**: The language model only executes its normal function calling step.
- **Fast execution**: Layout planning and expansion complete in 15 to 40 ms on local CPUs.
- **Guaranteed schema validity**: Surfaces expand through validated catalog patterns without syntax errors or broken tags.

### 2. Chat Mode (Two-Stage Synthesis)

In open-ended conversation where no domain tool exists, the agent operates in two stages:
1. **Stage 1**: The language model converts the user's conversational request into a structured `DecisionBlock` containing `intent`, `payload`, and optional copy fields (`title`, `summary`) or layout hints (`layout: ["role:key,key", ...]`).
2. **Stage 2**: The decision model scores layout families and archetypes, assigns payload pointers, and expands catalog components without making a second language model call.

```python
from a2ui.inference_formats.decision import DecisionBlock, DecisionSynthesizer

block = DecisionBlock(
    intent="Show stock portfolio overview",
    payload={"portfolio": "Growth", "totalValue": 128450.0},
    title="Portfolio Summary",
    summary="Daily portfolio valuation and holdings.",
)
output = await synthesizer.synthesize(
    block.intent,
    block.payload,
    surface_id="turn-1",
    title=block.title,
    summary=block.summary,
)
```

### 3. Variety and Zero-Cost Remix

The archetype grammar supports exploration and layout variation:
- **Variety Mode (`VarietyMode.NEAR_TOP`)**: Configured via `SynthesisConfig(variety=VarietyMode.NEAR_TOP, variety_margin=0.15)`. Options within the probability margin of the top candidate are sampled with a random seed rather than strictly choosing the argmax.
- **Zero-Cost Remix**: Call `synthesizer.remix(intent, payload, answers, seed=42)` using the recorded `output.decision_answers`. This re-samples layout choices instantly with zero model calls and zero decision backend queries.

## Backend Configuration

The decision model backend is selected through `A2UI_DECISION_BACKEND` or configured directly in code:

| Backend | Setup | Characteristics |
| :--- | :--- | :--- |
| `local` | Requires extra `a2ui-agent-sdk[decision-local]` | In-process ONNX cross-encoder running on CPU. |
| `jev` | Set `JEV_API_KEY` (or `A2UI_DECISION_AUTH`) | Remote TypeSafe Jev model over HTTP. |
| `mock` | Default offline fallback | Deterministic keyword-based heuristic for tests. |

### Environment Variables

- `A2UI_DECISION_BACKEND`: `local`, `jev`, `gev`, or `mock`.
- `A2UI_DECISION_LOCAL_THREADS`: Intra-operation CPU thread count for local ONNX execution (defaults to all available CPU cores).
- `A2UI_DECISION_MAX_SEQ_LENGTH`: Maximum token sequence length for passage pairs (defaults to 128 tokens).
- `A2UI_DECISION_SORT_BY_LENGTH`: Sort candidate pairs by length before inference to minimize padding waste (defaults to `true`).
- `A2UI_DECISION_TEMPERATURE`: Temperature scaling parameter applied to logits before computing softmax probabilities (defaults to 1.0).
- `A2UI_DECISION_URL`: Endpoint URL for remote HTTP backends.
- `A2UI_DECISION_AUTH` / `JEV_API_KEY`: Authentication token for remote backends.

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
