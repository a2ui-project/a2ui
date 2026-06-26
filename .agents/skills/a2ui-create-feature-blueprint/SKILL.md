---
name: a2ui-create-feature-blueprint
description: Provides instructions on how to create a new language-agnostic A2UI Feature Blueprint, ensuring consistency and ease of cross-language implementation.
---

# A2UI Create Feature Blueprint Skill

This skill provides step-by-step instructions on how to design, format, and check in a new A2UI **Feature Blueprint** to specify behavioral or protocol changes before they are implemented.

---

## **1. Design Principles for Feature Blueprints**

- **Language Agnosticism:** Keep the blueprint completely free of language-specific or framework-specific terminology (e.g., use "structure/record" instead of "data class" or "struct", "reactivity/signals" instead of "StateFlow" or "useState").
- **Generic Protocol Alignments:** Reference specific messages, schemas, or JSON pointers as the primary mechanism for interaction.
- **Portability:** Design the feature so that it can be implemented with minimal friction in any of our targeted SDK languages (Python, Kotlin, Swift, TypeScript/Dart).

---

## **2. Step-by-Step Creation Recipe**

### **Step 1: Determine Scope and Status**

- **Required Feature:** Essential features expected to be implemented across all codebases of a module. When creating a required feature, you must also plan to update the base Module Blueprint to include this feature's specification.
- **Optional Feature:** Platform-specific or experimental additions that do not mandate compliance across all SDKs.

### **Step 2: File Naming & Location**

- Target path: `blueprints/features/YYYY_MM_DD_feature_name.blueprint.md`
  - `YYYY_MM_DD` must be the current date (e.g. `2026_06_26`).
  - `feature_name` must be in `snake_case` (e.g. `dynamic_theming`).
  - The filename must end with `.blueprint.md`.

### **Step 3: Define the YAML Frontmatter**

Every feature blueprint must start with a YAML block containing:

```yaml
---
feature_name: feature_name # Must match the filename's snake_case name exactly
module_blueprints:
  - a2ui_core # Must be one or more valid module blueprint names
required: false # True for required features, false for optional
date_added: 2026-06-26 # Today's date in YYYY-MM-DD format
---
```

### **Step 4: Structure the Content**

Implement the canonical sections in Markdown:

1.  `# **[Feature Name] Feature Blueprint**` (Title)
2.  `## **Requirements**` (Clear human-readable summary of the feature goals and UX requirements)
3.  `## **Detailed Description of Changes**` (Programmatic descriptions, including changes to JSON schemas, data models, or message flows)
4.  `## **Links**` (References to GitHub issues, RFCs, or other specifications)
5.  `## **Test Cases & Conformance**` (Step-by-step scenarios that an implementation must pass to prove compliance)
6.  `## **Implementation Steps**` (High-level, language-agnostic sequence of tasks)
7.  `## **Checklist**` (Actionable checklist for developers/agents)

### **Step 5: Run Validation**

After writing the file, run the validation script to guarantee correctness:

```bash
python3 scripts/validate_blueprints.py
```

Fix any errors (e.g., frontmatter formatting, module references) before proposing changes.
