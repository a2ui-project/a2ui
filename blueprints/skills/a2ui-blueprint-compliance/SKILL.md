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

1. **Locate Codebase Blueprints**:
   - Find all `codebase.blueprint.md` files in the `blueprints/codebases/` directory.

2. **Audit Each Codebase**:
   - For each codebase blueprint, parse the frontmatter to extract:
     - `codebase_path`
     - `associated_module`
     - `module_blueprint_commit` (the git commit hash of the module blueprint it was last synced to)
     - `implemented_features` (list of feature names claimed to be implemented)
   - Locate the target module blueprint file at `blueprints/modules/<associated_module>.blueprint.md`.
   - If the module blueprint file does not exist, mark the codebase as `🔴 Error (Module blueprint missing)`.
   - **Step 2.1: Analyze Git Commit Sync Status**:
     - Retrieve the latest git commit hash of the module blueprint:
       ```bash
       git log -n 1 --pretty=format:%H -- blueprints/modules/<associated_module>.blueprint.md
       ```
     - Compare `module_blueprint_commit` with the latest commit hash to determine status (`🟢 Up to Date` or `🟡 Out of Date` or `🔴 Not Baselined`).
     - Retrieve the list of missing commits since the pinned hash:
       ```bash
       git log <module_blueprint_commit>..HEAD --oneline -- blueprints/modules/<associated_module>.blueprint.md
       ```

   - **Step 2.2: Audit Actual Implementation vs. Module Blueprint**:
     - Analyze the specifications, required interfaces, and behavior described in the module blueprint.
     - Inspect the source code in the codebase directory (`<codebase_path>`) to verify if the required specifications are implemented.
     - Identify any features, interfaces, or protocol requirements specified in the module blueprint (including those introduced in the missing commits since the pinned `module_blueprint_commit`) that are **not** currently implemented in the code.

   - **Step 2.3: Audit Claimed Features (`implemented_features`)**:
     - For each feature listed in the codebase blueprint's `implemented_features`:
       - Search the codebase (code files, symbols, tests, or documentation) to verify if the feature is actually implemented.
       - If it is not found or is incomplete, flag it as a discrepancy (e.g. "Claimed as implemented, but missing or incomplete in code").

   - **Step 2.4: Identify Implemented Optional Features**:
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
