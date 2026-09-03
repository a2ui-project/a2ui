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
To support granular skill modularity, every language SDK's `PromptGenerator` (or `InferenceFormat`) base contract MUST decompose prompt generation into three independent sub-methods:
- `generateBaseRules()`: Emits base syntax contracts, grammar specifications, and sentinel tags (`<a2ui>`).
- `generateCatalogInstructions(catalog)`: Emits component and function signatures or JSON schemas for a target catalog.
- `generateExamples(catalog, validate)`: Loads and formats few-shot examples for a target catalog.

### **2. Shared Surface & Host-Driven Surface Control**
- Inference format generators (e.g. `ExpressFormat`, `DirectJsonFormat`) MUST accept an optional `emitCreateSurface` flag (boolean, default: `true`).
- When `emitCreateSurface = false`, the generated prompt instructions MUST instruct the LLM NOT to emit `createSurface` messages or surface wrappers, allowing the client host application to manage surface creation and reuse shared surfaces across agent interaction turns.

### **3. Property Pruning & Protocol Version Alignment**
- Format compilers MUST inspect the specified protocol version (`v0.9`, `v0.9.1`, `v1.0`).
- For `v0.9` / `v0.9.1`, compilers MUST automatically prune properties not supported by the v0.9 basic catalog schema (such as `placeholder` in `TextInput`).

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
  - `Skill.from_format(fmt, name="a2ui")`: Compiles any format into a single monolithic Skill.
  - `Skill.from_catalog(catalog, fmt, name=None, description=None)`: Compiles a catalog into a clean, LLM-optimized catalog Skill (`a2ui-basic`, `a2ui-commerce`).
  - `Skill.core_syntax(fmt, name="a2ui-core")`: Compiles core grammar rules into a base core Skill.
- **`SkillSet`**: Collection of `Skill` objects representing a modular package (`a2ui-core`, `a2ui-basic`, `a2ui-commerce`).
  - `SkillSet.from_format(fmt, catalogs=None)`: Generates standard modular skill package for any format.
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

### **3. PromptGenerator Deduplication Contract**
- `PromptGenerator.generate()` serves as the single template method assembling `generate_base_rules()`, `generate_catalog_instructions()`, and `generate_examples()`.
- Format-specific prompt generators ONLY implement granular sub-methods without duplicating system prompt assembly.

---

## **YAML Frontmatter & Markdown Contract**

Every generated `SKILL.md` file MUST begin with a valid YAML frontmatter block:

```markdown
---
name: a2ui-core
description: Core A2UI protocol instructions and syntax rules for UI generation.
metadata:
  protocol_version: 0.9.1
  inference_format: express
  catalogs:
    - basic
    - commerce
---

# A2UI Express DSL Output Contract
...
```

---

## **Generation Modes & Naming Resolution**

1. **Unified (Monolithic) Mode (`generator.generate(...)`)**:
   - Produces a single `a2ui/SKILL.md` bundling base rules, component signatures for all provided catalogs, and combined few-shot examples.
   - Optional `name` and `description` parameters customize the single monolithic skill identity.

2. **Modular Mode (`generator.generateModular(...)`)**:
   - Produces `a2ui-core/SKILL.md` (base grammar & sentinel rules only). Base core skill name defaults to `a2ui-core` or optional `coreName` override.
   - Produces `a2ui-<catalog_name>/SKILL.md` for each provided catalog. Catalog skill names are auto-derived as `a2ui-<catalog_name>` and descriptions are pulled directly from each catalog's own schema metadata (`catalog.description`).

---

## **Language Conformance Verification Protocol**

To guarantee 100% behavioral parity across multi-language SDKs, all implementations MUST pass the language-agnostic conformance test suite against shared golden test vectors under `conformance/test_data/skills/`:

1. **`express_core.skill.md`**: Validates base grammar and sentinel tag instructions.
2. **`express_basic_catalog.skill.md`**: Validates basic catalog component signatures and pruning rules.
3. **`express_basic_monolithic.skill.md`**: Validates monolithic bundled skill output.

---

## **Implementation Steps**

1. Decompose `PromptGenerator` abstract base class into `generateBaseRules()`, `generateCatalogInstructions()`, and `generateExamples()`.
2. Add `emitCreateSurface` parameter to `ExpressCompiler`, `ExpressParser`, and `ExpressFormat`.
3. Implement `SkillConfig`, `SkillGenerator`, and `generateSkill` helper function in the client SDK.
4. Implement CLI execution entry point (`python -m a2ui.skill`, `npx a2ui-skill`, etc.).
5. Run conformance test suite against `conformance/test_data/skills/` golden test vectors.
