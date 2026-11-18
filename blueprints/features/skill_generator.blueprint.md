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

- `generate_base_rules() -> String`: Emits what every catalog shares, so text that combines several catalogs' instructions holds it once: base syntax contracts, grammar specifications, sentinel tags (e.g. `<a2ui>`), and any protocol schemas the format shows the model (such as Direct JSON's agent-to-renderer and common types schemas). It names no single catalog's components or functions.
- `generate_catalog_instructions(include_schema, catalog) -> String`: Emits component and function signatures or JSON schemas for the target catalog (or all bound catalogs if omitted).
- `generate_examples(catalog, validate) -> String`: Loads and formats few-shot examples for the target catalog (or all bound catalogs).

The prompt snippet and the monolithic skill are assembled from these sub-methods by one shared function, `assemble_instructions(generator, catalogs)`. `PromptGenerator.generate()` is final and returns `assemble_instructions(self)`; formats implement the sub-methods and the `catalogs` property and never override `generate()`.

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

- **What is wiped**: For each skill, the directory that directly holds the skill file (the dirname of `skill.filename`, for example `{output_dir}/a2ui-core` for `a2ui-core/SKILL.md`, or `{output_dir}/src/skills/nested` for `src/skills/nested/SKILL.md`) MUST be completely removed before writing new files. This ensures no stale or orphaned files (such as obsolete notes, old scripts, or deleted files) remain from prior exports.
- **What is NOT wiped**:
  - Ancestors of the skill's directory (for example `{output_dir}/src` for `src/skills/nested/SKILL.md`) MUST NOT be removed. Only the deepest directory named by the filename is cleaned.
  - Unrelated sibling skill directories in `output_dir` (e.g. `{output_dir}/git-workflow/` or `{output_dir}/custom-skill/`) MUST be strictly preserved and left untouched.
  - The `output_dir` root directory itself MUST NOT be wiped. A skill whose filename has no directory component (such as `FLAT.md`) is written into `output_dir` without removing anything.
- **Rejected filenames**: A `Skill` whose `filename` is absolute or has an empty, `.` or `..` segment (such as `../other/SKILL.md`) MUST be rejected with an error when it is constructed or added to a `SkillSet`, so `export_to_directory` can rely on every filename staying inside `output_dir` without re-checking each path.
- **Symlinks**: The filename check is lexical, so implementations MUST also resolve each skill directory's parent (its nearest existing ancestor) through symlinks before removing anything, and MUST raise an error, with nothing removed or written, when it resolves outside `output_dir` (for example `output_dir/src -> /elsewhere` with a skill at `src/skills/nested/SKILL.md`). A symlink or regular file sitting at the skill directory path itself MUST be removed as such, never followed, and replaced by a real directory.
- These rules are checked by the `export_to_directory` cases in `conformance/agent/skill.yaml`; the symlink rules are covered by each SDK's unit tests.

---

## **Cross-Language API Contract**

Every language implementation (`a2ui-python`, `a2ui-swift`, `a2ui-kotlin`, `a2ui-node`, `a2ui-go`) MUST expose equivalent interfaces and domain objects:

### **1. `PromptGenerator` Base Contract**

```
interface PromptGenerator {
    // The catalogs the generator describes, in order. Implemented by each format.
    catalogs: List<Catalog>

    // Returns what every catalog shares: syntax rules, grammar specs, sentinel output tags,
    // and any protocol schemas the format shows the model.
    generate_base_rules() -> String

    // Returns component and function signatures or JSON schemas for the target catalog (or all bound catalogs).
    generate_catalog_instructions(include_schema: Boolean = true, catalog: Catalog? = null) -> String

    // Returns formatted few-shot examples for the target catalog (or all bound catalogs).
    generate_examples(catalog: Catalog? = null, validate: Boolean = false) -> String

    // Final: returns assemble_instructions(this). Formats never override it.
    generate() -> String
}

// Joins a generator's sub-methods into the instructions for some catalogs.
// Defaults to the generator's own catalogs.
assemble_instructions(generator: PromptGenerator, catalogs: List<Catalog>? = null) -> String
```

#### **Assembly (`assemble_instructions`)**

`PromptGenerator.generate()` and `SkillGenerator.generate_skill()` both build their text with `assemble_instructions`:

1. Appends `generate_base_rules()` if non-empty.
2. Appends the catalog instructions if non-empty:
   - For the generator's own catalogs, calls `generate_catalog_instructions()` once with no catalog, so a format can render what its catalogs share once (for example, headings that name each catalog).
   - For any other catalogs, calls `generate_catalog_instructions(catalog=c)` for each and appends each non-empty result.
3. Appends the examples under `### Examples:` followed by a blank line if any are non-empty:
   - For the generator's own catalogs, calls `generate_examples()` once with no catalog.
   - For any other catalogs, calls `generate_examples(catalog=c)` for each and keeps each distinct result once, since a format whose examples aren't kept per catalog returns the same examples for each catalog.
4. Joins all non-empty sections with double newlines (`"\n\n"`).

The snippet has no role, workflow or UI preamble; the agent adds its own text around it. Implementations may cache the text for a generator's own catalogs, treating a generator as immutable once built.

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
    // The body is assemble_instructions(format.prompt_generator, catalogs), so for the
    // format's own catalogs it is the format's prompt snippet.
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
5. Converts string to lowercase and returns the result (e.g. `"catalogs/basic/v1/catalog.json"` -> `"basic"`).

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

1. **Decompose `PromptGenerator`**: In the base `PromptGenerator` class, declare the `catalogs` property and the `generate_base_rules()`, `generate_catalog_instructions()`, and `generate_examples()` sub-methods, implement `assemble_instructions()`, and make `generate()` a final method returning `assemble_instructions(self)` (for example `@typing.final` in Python or `@nonVirtual` in Dart).
2. **Implement `Skill` and `SkillSet` Domain Models**:
   - Implement `Skill` with YAML frontmatter serialization in `to_markdown()`.
   - Implement `SkillSet` with 3-tier lookup resolution in `get()` and scoped directory cleaning in `export_to_directory()`.
3. **Implement `SkillGenerator`**:
   - Wrap `InferenceFormat`.
   - Implement `generate_core_skill()`, `generate_catalog_skill()`, `generate_skill()`, and `generate_skillset()` adhering to catalog defaulting semantics.
   - Implement `clean_catalog_name()` helper.
4. **Wire Format Implementations**: Ensure specific format prompt generators (e.g. `ExpressPromptGenerator`, `DirectJsonPromptGenerator`) implement the `catalogs` property and the decomposed sub-methods without overriding `generate()`, and keep them internal to their format packages.
5. **Verify Conformance**: Run unit tests and execute the shared test suite in `conformance/agent/skill.yaml` against `conformance/test_data/skills/` golden files.
