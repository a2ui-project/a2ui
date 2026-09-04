---
feature_name: skill_generator
module_blueprints:
  - a2ui_agent
dependencies: []
date_added: 2026-09-03
---

# **Skill Generator Feature Blueprint**

This document specifies the language-agnostic architecture, API contracts, metadata specifications, and behavioral conformance rules for compiling A2UI component catalog definitions and inference format rules into standardized `SKILL.md` packages for managed agent platforms (such as Google Antigravity Managed Agent API, Vertex AI Agent Builder, Anthropic API with Skills, and Model Context Protocol agent sandboxes).

---

## **Requirements & Architectural Principles**

### **1. PromptGenerator Interface Decomposition**
To support granular skill modularity, every language SDK's `PromptGenerator` base contract MUST decompose prompt generation into three independent sub-methods:
- `generate_base_rules()`: Emits base syntax contracts, grammar specifications, and sentinel tags (`<a2ui>`).
- `generate_catalog_instructions(catalog)`: Emits component and function signatures or JSON schemas for target catalog(s).
- `generate_examples(catalog, validate)`: Loads and formats few-shot examples for target catalog(s).

`PromptGenerator.generate()` serves as the single template method assembling these sub-methods without code duplication.

### **2. Additive Composition Layer**
- Skill functionality MUST sit strictly **on top** of `InferenceFormat` and `PromptGenerator` via composition.
- Core inference format classes (parsers, lexers, visitors, compilers) remain format-agnostic and clean, with zero skill-specific logic or non-essential prompt modifications.

### **3. Multi-Catalog Prompt & Skill Generation**
- When an `InferenceFormat` or `Skill` request contains multiple catalogs (e.g. `[basic_catalog, commerce_catalog]`), prompt generators and skill constructors MUST iterate through **all** catalogs and compile instructions for **every** catalog — never selecting a single default or random catalog.

### **4. Remote Environment Directory Conventions**
For managed agent sandbox environments (such as `.agents/` or `/.agents/`), generated skill packages MUST adhere to standard inline file target paths:
- Root guide: `.agents/AGENTS.md`
- Modular core syntax skill: `.agents/skills/a2ui-core/SKILL.md`
- Modular catalog skills: `.agents/skills/a2ui-<catalog_name>/SKILL.md`
- Unified monolithic skill: `.agents/skills/a2ui/SKILL.md`

---

## **Cross-Language API Contract**

Every language implementation (`a2ui-python`, `a2ui-swift`, `a2ui-kotlin`, `a2ui-node`, `a2ui-go`) MUST expose an equivalent API:

### **1. Skill & SkillSet Composition Domain Objects**
- **`Skill`**: Format-agnostic skill document container (`name`, `description`, `content`, `metadata`, `filename`). Provides `.to_markdown()` for frontmatter serialization.
  - `Skill.from_format(fmt, name="a2ui", description=None, catalogs=None)`: Compiles any format into a single monolithic Skill containing base rules + instructions for all specified catalogs.
  - `Skill.from_catalog(catalog, fmt, name=None, description=None)`: Compiles a catalog into a clean, LLM-optimized catalog Skill (`a2ui-basic`, `a2ui-commerce`).
  - `Skill.core_syntax(fmt, name="a2ui-core")`: Compiles core grammar rules into a base core Skill.
- **`SkillSet`**: Collection of `Skill` objects representing a modular package (`a2ui-core`, `a2ui-basic`, `a2ui-commerce`).
  - `SkillSet.from_format(fmt, catalogs=None, core_name="a2ui-core")`: Generates standard modular skill package for any format.
  - `.export_to_directory(output_dir)`: Writes modular skills to disk.
  - `.to_dict()` / `[key]`: Dictionary serialization and indexing.

### **2. LLM-Optimized Frontmatter Spec**
Skill frontmatter headers MUST be concise, LLM-friendly, and omit internal SDK metadata details:
```yaml
---
name: a2ui-basic
description: UI component catalog signatures for basic. Use when building basic user interface components.
---
```

---

## **YAML Frontmatter & Markdown Contract**

Every generated `SKILL.md` file MUST begin with a valid YAML frontmatter block:

```markdown
---
name: a2ui-core
description: Core A2UI protocol instructions and syntax rules for UI generation.
---

# A2UI Express DSL Output Contract
...
```

---

## **Language Conformance Verification Protocol**

To guarantee 100% behavioral parity across multi-language SDKs, all implementations MUST pass the language-agnostic conformance test suite specified in `conformance/agent/skill.yaml` against shared golden test vectors under `conformance/test_data/skills/`:

1. **`express_core.skill.md`**: Validates base grammar and sentinel tag instructions.
2. **`express_basic_catalog.skill.md`**: Validates basic catalog component signatures.
3. **`express_basic_monolithic.skill.md`**: Validates monolithic bundled skill output.

---

## **Implementation Steps**

1. Decompose `PromptGenerator` abstract base class into `generate_base_rules()`, `generate_catalog_instructions()`, and `generate_examples()`.
2. Implement `Skill` and `SkillSet` domain factory constructors in the client SDK (`Skill.from_format`, `Skill.from_catalog`, `Skill.core_syntax`, `SkillSet.from_format`).
3. Add `conformance/agent/skill.yaml` declaring YAML-driven conformance tests.
4. Run unit tests and conformance test suite against `conformance/test_data/skills/` golden test vectors.
