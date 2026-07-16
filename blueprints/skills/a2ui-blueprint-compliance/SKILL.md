---
name: a2ui-blueprint-compliance
description: Verification of platform codebase blueprint compliance against the latest module blueprints.
---

# A2UI Blueprint Compliance Check Skill

This skill guides you through the process of auditing the repository's codebase blueprints to verify that they are synchronized with the latest module specifications, and posting a weekly report issue.

---

## **Instructions**

> [!IMPORTANT]
> All codebase auditing must be performed using static/structural inspection (e.g. reading file contents, grep searching symbols, checking git logs, or static lints). Do not run package/dependency installations (like `yarn install`, `pip install`, `pub get`), compile code, or execute dynamic test suites.

1. **Run Check Compliance Script**:
   - Run the compliance checker script to generate the baseline status of the repository:
     ```bash
     python3 .agents/skills/a2ui-blueprint-compliance/scripts/check_compliance.py
     ```
   - This script automatically discovers codebase blueprints, parses their pinned commits, compares them against module blueprints git logs, and formats the baseline Markdown report structure.

2. **Audit Each Codebase (Manual Verification)**:
   - For each codebase, perform the following static code analysis tasks:
     - **Step 2.1: Audit Actual Implementation vs. Module Blueprint**:
       - Analyze the specifications, required interfaces, and behavior described in the module blueprint (located at `blueprints/modules/<associated_module>.blueprint.md`).
       - Inspect the source code in the codebase directory (`<codebase_path>`) to verify if the required specifications are implemented.
       - Identify any features, interfaces, or protocol requirements specified in the module blueprint (including those introduced in the missing commits listed in the script's output report) that are **not** currently implemented in the code.

   - **Step 2.2: Audit Claimed Features (`implemented_features`)**:
     - For each feature listed in the codebase blueprint's `implemented_features`:
       - Search the codebase (code files, symbols, tests, or documentation) to verify if the feature is actually implemented.
       - If it is not found or is incomplete, flag it as a discrepancy (e.g. "Claimed as implemented, but missing or incomplete in code").

   - **Step 2.3: Identify Implemented Optional Features**:
     - Inspect the codebase for any implemented optional features (either from the `blueprints/features/` folder, or from codebase-specific extensions).
     - Verify if they are correctly documented in the codebase blueprint's `implemented_features`.
     - Compile a list of verified implemented optional features.

3. **Format the Report**:
   - Build a Markdown report with a summary table listing:
     - Codebase Path
     - Associated Module
     - Status (Up to Date, Out of Date, Not Baselined, Error)
     - Commits Behind
     - Pinned Commit
     - Latest Commit
   - For each codebase, include a detailed section listing:
     - **Missing Required Features**: Features/specifications in the module blueprint (or in newer commits to it) that are missing from the implementation code.
     - **Feature Claims Verification / Discrepancies**:
       - Features listed in `implemented_features` that are missing or incomplete in the code.
       - Implemented features that are missing from the `implemented_features` frontmatter list.
     - **Implemented Optional Features**: A list of optional features verified as implemented in the code.
     - **Missing Commits / Spec Diffs**: The list of git commits since the pinned hash.
   - Return this Markdown report as your final response.
