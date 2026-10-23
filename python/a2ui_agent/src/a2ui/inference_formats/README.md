# A2UI Inference Formats

This directory contains inference format implementations (`direct_json`, `express`, `elemental`, `atom`, `decision`) for the A2UI Python SDK.

## Design Philosophy

An **Inference Format** defines how an LLM or agent emits UI definitions (e.g. Direct JSON, Express DSL, Elemental HTML, or Atom). In the `decision` format the model emits an intent, the data to show, and an optional `layout` brief (`["role:key,key", ...]`). A local decision model (`DecisionSynthesizer`, configured via `A2UI_DECISION_*` environment variables or the `a2ui-agent-sdk[decision-local]` extra) plans the surface through the catalog-agnostic archetype grammar (`ArchetypeGrammar`, `LayoutPlanner`) in a single batched `DecisionBackend.answer` call, expands blocks through the active catalogs' pattern libraries (`PatternLibrary`, `PatternExpander`), and falls back to flat component synthesis when no archetype applies.

### Catalog-Agnostic Prompt Generation Rules

To ensure long-term maintainability, portability, and catalog independence:

1. **Single Source of Truth**:
   All component signatures, parameter descriptions, function helpers, and property constraints MUST be derived dynamically from the `Catalog` JSON schema via schema helpers (`CatalogSchemaHelper`).

2. **No Hardcoded Catalog String Hacks**:
   Prompt generators (`PromptGenerator` implementations) MUST NOT hardcode catalog-specific string replacements, regular expression filters, or custom text manipulations to modify component or property descriptions at runtime.

3. **Schema First**:
   If a component parameter description or constraint needs adjustment (such as clarifying inline component usage vs. reference IDs), update the catalog JSON schema file (`specification/<version>/catalogs/basic/catalog.json`) directly, rather than patching prompt generator logic.

4. **Independent Grammar Contracts**:
   Format-level grammar rules (such as `<a2ui>` sentinel tags or variable assignment syntax in `EXPRESS_RULES`) define the output syntax structure and MUST NOT contradict property guidelines defined in the catalog JSON schema.

### Decision Format Archetypes, Patterns, and Layout Brief

The `decision` inference format separates layout planning from catalog-specific component expansion (see [catalogs/decision/README.md](../../../../../catalogs/decision/README.md)):

- **Archetype Grammar (`ArchetypeGrammar`, `LayoutPlanner`)**: Plans surfaces across 6 job families (`browse`, `monitor`, `inspect`, `act`, `input`, `converse`) and 15 archetypes (`feed`, `catalog`, `search_results`, `comparison`, `dashboard`, `status`, `detail`, `profile`, `document`, `confirm`, `checkout`, `form`, `settings`, `result`, `thread`) in a single batched `DecisionBackend.answer(batch)` call (`QuestionKind`: `choice`, `boolean`, `score`).
- **Pattern Libraries (`PatternLibrary`, `MergedPatternLibrary`, `PatternExpander`)**: Each catalog ships a `patterns.json` file mapping the 17 abstract block patterns (`page`, `banner`, `picture`, `media`, `filters`, `headline`, `facts`, `prose`, `collection`, `comparison`, `steps`, `form`, `groups`, `actions`, `outcome`, `conversation`, `compose`) onto its concrete components without coupling the planner to any catalog's component names.
- **Optional Layout Brief (`LayoutBrief`)**: An LLM or tool caller can pass `layout: ["role:key,key", ...]` (up to 6 sections) on a `<a2ui>` decision block or `DecisionRenderTool` call to pin the job family or block sequence and steer pointer assignment while the decision model fills in anatomy, salience, and action gates.
