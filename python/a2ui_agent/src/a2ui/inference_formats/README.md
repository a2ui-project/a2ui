# A2UI Inference Formats

This directory contains inference format implementations (`direct_json`, `express`, `elemental`, `atom`, `decision`) for the A2UI Python SDK.

## Design Philosophy

An **Inference Format** defines how an LLM or agent emits UI definitions (e.g. Direct JSON, Express DSL, Elemental HTML, or Atom). In the `decision` format the model emits only an intent and the data to show, and a local decision model (`DecisionSynthesizer`, configured via `A2UI_DECISION_*` environment variables or the `a2ui-agent-sdk[decision-local]` extra) selects and binds the components from the catalogs.

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
