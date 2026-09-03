---
feature_name: skill_generator
module_blueprints:
  - a2ui_agent
dependencies: []
date_added: 2026-09-03
---

# **Skill Generator Feature Blueprint**

This document specifies the language-agnostic architecture and interface contracts for compiling A2UI component catalog definitions and inference format rules into standardized `SKILL.md` packages for managed agent platforms (such as Google Antigravity API, Vertex AI Agent Builder, Anthropic API with Skills, and Model Context Protocol agent sandboxes).

---

## **Requirements**

1. **PromptGenerator Interface Decomposition**:
   - Decompose prompt generation into three distinct sub-methods:
     - `generate_base_rules()`: Emits syntax contract, grammar, and sentinel wrapper rules (`<a2ui>`).
     - `generate_catalog_instructions(catalog)`: Emits component and function signatures or JSON schemas for a target catalog.
     - `generate_examples(catalog, validate)`: Loads and formats few-shot examples for a target catalog.

2. **Skill Package Structure**:
   - Output valid markdown files named `SKILL.md` containing standard YAML frontmatter block at the top.
   - Standard frontmatter keys: `name`, `description`, `metadata` (`protocol_version`, `inference_format`, `catalogs`).

3. **Generation Modes**:
   - **Unified (Monolithic) Mode**: Generates a single `a2ui/SKILL.md` file bundling base rules, component signatures for all provided catalogs, and combined few-shot examples.
   - **Modular Mode**: Generates `a2ui-core/SKILL.md` (containing base rules only) plus individual `a2ui-<catalog_name>/SKILL.md` files (containing signatures and examples for specific domain catalogs).

4. **Distribution & Workflows**:
   - Provide lightweight direct module execution (`python -m a2ui.skill`) and programmatic helper functions (`generate_skill(...)`).

---

## **Detailed Description of Changes**

### **1. Module Additions (`a2ui_agent`)**

Add a dedicated `skill` namespace containing:

- `SkillConfig`: Data structure holding generation options (`inference_format`, `catalogs`, `name`, `description`, `modular`, `include_examples`, `validate_examples`, `metadata`, `output_dir`).
- `SkillGenerator`: Central generator engine performing catalog resolution, prompt generation decomposition, frontmatter formatting, and file export.
- `generate_skill()`: Developer-facing helper function.
- CLI Entry Point: Light argument parser facilitating build-time execution.

### **2. Frontmatter Specification**

```yaml
---
name: a2ui
description: Generates interactive user interface components for user requests.
metadata:
  protocol_version: '0.9.1'
  inference_format: express
  catalogs:
    - basic
---
```

---

## **Test Cases & Conformance**

1. **Unified Skill Generation Conformance**: Asserts generated `a2ui/SKILL.md` contains valid YAML frontmatter and full DSL rules.
2. **Modular Skill Generation Conformance**: Asserts generation outputs `a2ui-core/SKILL.md` and `a2ui-<catalog_name>/SKILL.md` files.
3. **Metadata & Custom Overrides Conformance**: Asserts custom `name`, `description`, and `metadata` overrides parse correctly.
4. **Directory Export Conformance**: Verifies files are written to specified target directory paths.

---

## **Implementation Steps**

1. Update `PromptGenerator` abstract base class and concrete implementations (`DirectJsonPromptGenerator`, `ExpressPromptGenerator`, `ElementalPromptGenerator`, `AtomPromptGenerator`).
2. Implement `SkillConfig`, `SkillGenerator`, and `generate_skill` helper in `a2ui.skill`.
3. Implement `python -m a2ui.skill` CLI entry point.
4. Add unit and conformance tests.
