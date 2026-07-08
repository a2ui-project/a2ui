---
name: a2ui-create-feature-blueprint
description: Provides instructions on how to create a new language-agnostic A2UI Feature Blueprint, ensuring consistency and ease of cross-language implementation.
---

# A2UI Create Feature Blueprint Skill

This skill provides step-by-step instructions on how to design, format, and check in a new A2UI **Feature Blueprint** inside `blueprints/features/` to specify behavioral or protocol changes before implementation.

---

## **1. Design Principles for Feature Blueprints**

- **Language Agnosticism:** Keep the blueprint completely free of language-specific or framework-specific terminology.
- **Generic Protocol Alignment:** Reference specific messages, schemas, or JSON pointers as the primary mechanism for interaction.
- **Portability:** Design the feature so that it can be implemented cleanly across targeted SDK languages.

---

## **2. Step-by-Step Creation Recipe**

### **Step 1: File Naming & Location**

- **Target Path:** `blueprints/features/<feature_name>.blueprint.md`
  - `<feature_name>` must be in `snake_case` (e.g. `dynamic_theming.blueprint.md`).
  - Do **NOT** prefix filenames with a date.
- **Initial Status:** All newly created feature blueprints in `blueprints/features/` start as **optional** (unmerged).

### **Step 2: Define YAML Frontmatter**

Every feature blueprint must start with a YAML block containing:

```yaml
---
feature_name: feature_name # Must match the filename's snake_case name exactly
module_blueprints:
  - a2ui_core # One or more valid module blueprint names affected
dependencies: [] # Optional list of prerequisite feature names
date_added: 2026-07-07 # Date initially authored (YYYY-MM-DD)
---
```

### **Step 3: Structure Content**

Implement canonical Markdown sections:

1. `# **[Feature Name] Feature Blueprint**`
2. `## **Requirements**`
3. `## **Detailed Description of Changes**`
4. `## **Links**`
5. `## **Test Cases & Conformance**`
6. `## **Implementation Steps**`

### **Step 4: Validate Blueprint**

Run the blueprint validator script:

```bash
python3 blueprints/validate_blueprints.py
```
