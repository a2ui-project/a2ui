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

To support granular skill modularity and avoid duplicating prompt-building logic, every language SDK's `PromptGenerator` base contract MUST decompose prompt generation into three independent sub-methods:

- `generate_base_rules() -> String`: Emits base syntax contracts, grammar specifications, and sentinel tags (e.g. `<a2ui>`). Must be completely catalog-agnostic.
- `generate_catalog_instructions(include_schema, catalog) -> String`: Emits component and function signatures or JSON schemas for the target catalog (or all bound catalogs if omitted).
- `generate_examples(catalog, validate) -> String`: Loads and formats few-shot examples for the target catalog (or all bound catalogs).

`PromptGenerator.generate()` serves as the single **Template Method** assembling these sub-methods into a complete agent system prompt.

### **2. Additive Composition Layer**

- Skill generation functionality MUST sit strictly **on top** of `InferenceFormat` and `PromptGenerator` via composition (`SkillGenerator(fmt)`).
- Core inference format classes (parsers, lexers, visitors, compilers) remain format-agnostic and clean, with zero skill-specific logic or non-essential prompt modifications.

### **3. Multi-Catalog Prompt & Skill Generation**

- When an `InferenceFormat` or `SkillGenerator` request contains multiple catalogs (e.g. `[basic_catalog, commerce_catalog]`), generators MUST iterate through **all** catalogs and compile instructions for **every** catalog — never selecting a single default or random catalog.

### **4. Catalog Defaulting Semantics**

- When compiling skills or skillsets (`generate_skill`, `generate_skillset`), if the `catalogs` parameter is omitted or `null`, the generator MUST default to all catalogs configured on the underlying `InferenceFormat`.
- When an explicit list of catalogs is provided, the generator MUST compile only those specified catalogs without mutating or polluting the underlying format defaults.
- For `generate_catalog_skill(catalog=None)`, if `catalog` is omitted, the generator MUST default to the primary/first catalog configured on the format. If no catalogs are configured on the format, it MUST raise an error.

### **5. Remote Environment Directory Conventions**

For managed agent sandbox environments (such as `.agents/` or `/.agents/`), generated skill packages MUST adhere to standard inline file target paths:

- Root guide: `.agents/AGENTS.md`
- Modular core syntax skill: `.agents/skills/a2ui-core/SKILL.md`
- Modular catalog skills: `.agents/skills/a2ui-<catalog_name>/SKILL.md`
- Unified monolithic skill: `.agents/skills/a2ui/SKILL.md`

### **6. Scoped Directory Cleaning Contract on Export**

When exporting a `SkillSet` to disk via `export_to_directory(output_dir)`:

- **What is wiped**: Existing subdirectories matching skills in the set (for example, `{output_dir}/a2ui-core` or `{output_dir}/a2ui-basic`) MUST be completely removed before writing new files. This ensures no stale or orphaned files (such as obsolete notes, old scripts, or deleted files) remain from prior exports.
- **What is NOT wiped**:
  - Unrelated sibling skill directories in `output_dir` (e.g. `{output_dir}/git-workflow/` or `{output_dir}/custom-skill/`) MUST be strictly preserved and left untouched.
  - The `output_dir` root directory itself MUST NOT be wiped.

---

## **Cross-Language API Contract**

Every language implementation (`a2ui-python`, `a2ui-swift`, `a2ui-kotlin`, `a2ui-node`, `a2ui-go`) MUST expose equivalent interfaces and domain objects:

### **1. `PromptGenerator` Base Contract**

```
interface PromptGenerator {
    // Returns base syntax rules, grammar specs, and sentinel output tags. Must be catalog-agnostic.
    generate_base_rules() -> String

    // Returns component and function signatures or JSON schemas for the target catalog (or all bound catalogs).
    generate_catalog_instructions(include_schema: Boolean = true, catalog: Catalog? = null) -> String

    // Returns formatted few-shot examples for the target catalog (or all bound catalogs).
    generate_examples(catalog: Catalog? = null, validate: Boolean = false) -> String

    // Template Method: Assembles format-specific system prompt instructions.
    generate(
        role_description: String = "",
        workflow_description: String = "",
        ui_description: String = "",
        include_schema: Boolean = true,
        include_examples: Boolean = false,
        validate_examples: Boolean = false
    ) -> String
}
```

#### **Template Method Assembly (`generate`)**

The base `generate()` method orchestrates prompt assembly across all inference formats:

1. Appends `role_description` if non-empty.
2. Combines `generate_base_rules()` and `workflow_description` under `## Workflow Description:` if present.
3. Appends `ui_description` under `## UI Description:` if present.
4. If `include_schema` is true, calls `generate_catalog_instructions(include_schema=true)` and appends the result if non-empty.
5. If `include_examples` is true, calls `generate_examples(validate=validate_examples)` and appends the result under `### Examples:` if non-empty.
6. Joins all non-empty sections with double newlines (`"\n\n"`).

### **2. `Skill` Domain Model**

A pure format-agnostic document container representing a single skill package:

```
class Skill {
    name: String                     // e.g. "a2ui-core", "a2ui-basic", "a2ui"
    description: String              // LLM-facing purpose summary
    content: String                  // Markdown body content
    metadata: Map<String, Any>?      // Optional metadata map (defaults to empty)
    filename: String                 // Relative file path (defaults to "{name}/SKILL.md")

    constructor(
        name: String,
        description: String,
        content: String,
        metadata: Map<String, Any>? = null,
        filename: String? = null     // Defaults to "{name}/SKILL.md" if omitted
    )

    // Serializes the skill into valid markdown with YAML frontmatter.
    to_markdown() -> String
}
```

#### **Frontmatter Serialization Rules (`to_markdown`)**

- Serializes a YAML header enclosed within `---` delimiters, followed by two newlines and the stripped content ending with a newline.
- The YAML header MUST include `name` and `description`.
- If `metadata` is provided and non-empty, it is serialized under the `metadata:` key.
- SDK-internal properties MUST NOT be included in frontmatter.

```markdown
---
name: a2ui-core
description: Core A2UI protocol instructions and syntax rules for UI generation.
---

# Content Body...
```

### **3. `SkillSet` Domain Collection**

A collection container of `Skill` objects representing a modular or multi-skill package:

```
class SkillSet {
    skills: Map<String, Skill>       // Internal collection keyed by relative filename

    constructor(skills: Map<String, Skill>? = null)

    // Adds or replaces a Skill in the collection (keyed by skill.filename).
    add(skill: Skill) -> Void

    // Retrieves a Skill using a 3-tier lookup hierarchy:
    // 1. Exact filename match (e.g. "a2ui-core/SKILL.md")
    // 2. Exact skill name match (e.g. "a2ui-core")
    // 3. Substring match within filename ONLY IF query length >= 3 (e.g. "basic" matches "a2ui-basic/SKILL.md")
    // Returns null/nil if no match is found.
    get(query: String) -> Skill?

    // Serializes all skills into a dictionary mapping filename -> markdown string.
    to_dict() -> Map<String, String>

    // Writes all skills to disk in output_dir:
    // 1. Identifies unique top-level skill directory names (e.g. "a2ui-core").
    // 2. Recursively deletes matching top-level skill folders in output_dir if they exist.
    // 3. Strictly preserves unrelated sibling folders and the output_dir root.
    // 4. Writes out each skill file to {output_dir}/{filename}.
    // Returns a map of filename -> markdown string.
    export_to_directory(output_dir: String) -> Map<String, String>

    // Collection indexing support: skill_set[key] (raises error if not found)
    // Supports iteration, length, keys, and values.
}
```

### **4. `SkillGenerator` Compiler Layer**

A format-agnostic compiler wrapping an `InferenceFormat` strategy:

```
class SkillGenerator {
    format: InferenceFormat

    constructor(format: InferenceFormat)

    // Compiles base grammar rules into a base core Skill.
    // Default name: "a2ui-core"
    // Default description: "Core A2UI protocol instructions and syntax rules for UI generation."
    generate_core_skill(
        name: String = "a2ui-core",
        description: String? = null
    ) -> Skill

    // Compiles a single catalog into a dedicated catalog Skill.
    // Defaults to the format's bound catalog if catalog is omitted (raises error if format is unbound).
    // Derives clean catalog name via clean_catalog_name(catalog).
    // Default name: "a2ui-{clean_name}"
    // Default description: catalog.description or "UI component catalog signatures for {clean_name}. Use when building {clean_name} user interface components."
    generate_catalog_skill(
        catalog: Catalog? = null,
        name: String? = null,
        description: String? = null,
        include_examples: Boolean = true
    ) -> Skill

    // Compiles an InferenceFormat into a single unified (monolithic) Skill.
    // Defaults to all catalogs bound to the format if catalogs is omitted.
    // Default name: "a2ui"
    // Default description: "Generates interactive user interface components for user requests."
    generate_skill(
        name: String = "a2ui",
        description: String? = null,
        catalogs: List<Catalog>? = null
    ) -> Skill

    // Compiles standard modular skills (1 core skill + 1 skill per catalog) into a SkillSet.
    // Defaults to all catalogs bound to the format if catalogs is omitted.
    generate_skillset(
        catalogs: List<Catalog>? = null,
        core_name: String = "a2ui-core"
    ) -> SkillSet
}
```

### **5. Helper Utilities**

#### **`clean_catalog_name(catalog) -> String`**

Derives a clean, LLM-friendly catalog name from a catalog ID, URL, or file path:

1. Retrieves `catalog.id` or `catalog.catalog_id` (fallback to `"basic"` if missing/empty).
2. Normalizes path separators (`\` -> `/`).
3. Strips `.json` extension and splits path by `/`.
4. Extracts terminal component. If the terminal component starts with `"v"` (version segment like `v0_9`) and has a preceding segment, uses the preceding segment.
5. Converts string to lowercase and returns the result (e.g. `"catalogs/v1_0/basic/catalog.json"` -> `"basic"`).

#### **`resolve_catalogs_list(catalogs, format) -> List<Catalog>`**

1. If `catalogs` argument is provided and not null: resolves any file path strings or catalog config descriptors to instantiated `Catalog` objects.
2. If `catalogs` is omitted or null: retrieves all catalogs configured on `format` (e.g. `format.supported_catalogs` or `format.catalogs`).

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

For catalog-specific skills:

```markdown
---
name: a2ui-basic
description: UI component catalog signatures for basic. Use when building basic user interface components.
---

### Positional Component Signatures

...
```

---

## **Language Conformance Verification Protocol**

To guarantee 100% behavioral parity across multi-language SDKs, all implementations MUST pass the language-agnostic conformance test suite specified in `conformance/agent/skill.yaml` against shared golden test vectors under `conformance/test_data/skills/`:

1. **`express_core.skill.md`**: Validates base grammar and sentinel tag instructions.
2. **`express_basic_catalog.skill.md`**: Validates basic catalog component signatures.
3. **`express_basic_monolithic.skill.md`**: Validates monolithic bundled skill output.
4. **`skill_set` modular test**: Validates that generating a skillset produces `a2ui-core/SKILL.md` and `a2ui-basic/SKILL.md`.

---

## **Implementation Steps**

When implementing this feature in a client language SDK:

1. **Decompose `PromptGenerator`**: In the base `PromptGenerator` class, implement `generate_base_rules()`, `generate_catalog_instructions()`, and `generate_examples()`, and wire `generate()` as a Template Method.
2. **Implement `Skill` and `SkillSet` Domain Models**:
   - Implement `Skill` with YAML frontmatter serialization in `to_markdown()`.
   - Implement `SkillSet` with 3-tier lookup resolution in `get()` and scoped directory cleaning in `export_to_directory()`.
3. **Implement `SkillGenerator`**:
   - Wrap `InferenceFormat`.
   - Implement `generate_core_skill()`, `generate_catalog_skill()`, `generate_skill()`, and `generate_skillset()` adhering to catalog defaulting semantics.
   - Implement `clean_catalog_name()` helper.
4. **Wire Format Implementations**: Ensure specific format prompt generators (e.g. `ExpressPromptGenerator`, `DirectJsonPromptGenerator`) implement the decomposed sub-methods.
5. **Verify Conformance**: Run unit tests and execute the shared test suite in `conformance/agent/skill.yaml` against `conformance/test_data/skills/` golden files.
