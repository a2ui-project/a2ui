---
name: a2ui-audit
description: Main coordination skill to run the blueprint compliance, documentation synchronization, and test quality audits, posting the combined results as a labeled GitHub issue.
---

# A2UI Compliance Verification Skill

This skill coordinates the execution of specification compliance, documentation
sync, and test quality audits, and publishes the combined results as a GitHub issue.

Other than writing a report and creating an issue, this skill is purely a
read-only skill; no changes are to be made to the codebase. Do not attempt to
fix issues.

---

## **Instructions**

1. **Audit Codebase Blueprint Compliance**:
   - Execute `python3 blueprints/skills/a2ui-blueprint-compliance/scripts/check_compliance.py` to dynamically discover all 8 production codebases and generate the baseline Markdown status report.
   - Run the sub-skill [`a2ui-blueprint-compliance`](../../../blueprints/skills/a2ui-blueprint-compliance/SKILL.md) to audit each discovered codebase for missing features or blueprint drift.
   - Save the compiled Markdown report to a temporary file in the workspace (e.g., `compliance_report.md`) under the header `## Codebase Blueprint Compliance Audit`.

2. **Audit Code vs. Documentation Synchronization**:
   - Run the sub-skill [`a2ui-doc-sync-check`](../a2ui-doc-sync-check/SKILL.md) to audit documentation drift across `docs/`, `specification/`, codebase READMEs, and inline docstrings.
   - Append the returned Markdown report to `compliance_report.md` under a new header `## Code & Documentation Sync Audit`.

3. **Audit Test Quality & Assertion Strength**:
   - Run the sub-skill [`a2ui-test-quality-check`](../a2ui-test-quality-check/SKILL.md) to audit test suites across all codebases for weak assertions and behavioral verification.
   - Append the returned Markdown report to `compliance_report.md` under a new header `## Test Quality & Assertions Audit`.

4. **Summarize the report**:
   - Add a `## Summary` section at the top of the `compliance_report.md` file with a detailed overview of the audit scope and key findings across all audited codebases.
   - Add a `## Recommendations` section listing actionable, prioritized follow-up items formatted as a numbered list (e.g. `1. **P0**: ...`). Each numbered item MUST represent a concrete, self-contained remediation task.

5. **Format and Detail Requirements**:
   - **MANDATORY COMPLETE REPOSITORY COVERAGE**: The report MUST include status rows and detailed findings for **ALL 8 production codebases** discovered by `check_compliance.py`. Do NOT truncate, shortcut, or abbreviate the summary tables or detailed findings.
   - For each audit section, provide specific evidence:
     - Exact file paths (e.g. `agent_sdks/python/a2ui_agent/transport.py:L45-L60`).
     - Specific function/class names, parameter mismatches, or missing feature descriptions.
     - Concrete examples of weak assertions (e.g. `assert response is not None` in `eval/tests/test_strategies.py`).
   - Follow the structure provided in the **Report Format Template** below.

6. **Publish Report**:
   - Execute the local Python helper script to create the GitHub issue containing the combined reports:
     ```bash
     python3 .agents/skills/a2ui-audit/scripts/create_compliance_report.py compliance_report.md --repo a2ui-project/a2ui
     ```
   - The publishing script will create the GitHub issue, automatically inject copyable remediation prompt blocks referencing the newly created issue URL under each recommendation item, and update the issue body.
   - Ensure the helper script runs successfully.
   - Clean up the temporary file `compliance_report.md` after completion.

---

## **Report Format Template**

When compiling `compliance_report.md`, use the following structure:

```markdown
## Summary

[Provide a 2-3 paragraph detailed summary explaining the repository state, key areas audited across SDKs, renderers, and tests, and major findings.]

## Recommendations

1. **[Priority]**: **[Title]**
   - [Clear detailed explanation of the fix needed, specifying affected directories or modules.]

2. **[Priority]**: **[Title]**
   - [Clear detailed explanation of the fix needed, specifying affected directories or modules.]

## Codebase Blueprint Compliance Audit

| Codebase Implementation | Associated Module   | Status | Commits Behind | Current Commit | Latest Commit |
| ----------------------- | ------------------- | ------ | -------------- | -------------- | ------------- |
| `path/to/codebase`      | `associated_module` | Status | X              | `commit_hash`  | `latest_hash` |

### Detailed Findings & Discrepancies

- **[Codebase Path]**: [Detailed description of missing specifications, missing required features, or frontmatter commit hash drift.]

## Code & Documentation Sync Audit

| Directory     | Status | Identified Issues |
| ------------- | ------ | ----------------- |
| `path/to/dir` | Status | Brief Summary     |

### Detailed Findings

- **README Mismatches**:
  - `path/to/README.md`: [Exact invalid command or outdated setup step found in README.]
- **Docstring / API Drift**:
  - `path/to/file.ext:L12-L34`: [Specific parameter or return type mismatch between implementation and docstring/comments.]

## Test Quality & Assertions Audit

| Suite / Module  | Status | Observations  |
| --------------- | ------ | ------------- |
| `path/to/tests` | Status | Brief Summary |

### Detailed Findings

- **Weak Assertions**:
  - `path/to/test_file.ext` (`test_function_name`): [Explanation of weak assertion, e.g. using `assertNotNull` instead of schema/type check.]
- **Missing Edge Case Tests**:
  - `path/to/module`: [Boundary conditions, error cases, or invalid inputs that lack test coverage.]
```

---

## **References**

- Refer to the [`a2ui-blueprint-compliance`](../../../blueprints/skills/a2ui-blueprint-compliance/SKILL.md) skill for codebase blueprint checking.
- Refer to the [`a2ui-doc-sync-check`](../a2ui-doc-sync-check/SKILL.md) skill for documentation sync checking.
- Refer to the [`a2ui-test-quality-check`](../a2ui-test-quality-check/SKILL.md) skill for test quality and assertion checking.
- Refer to the [`gh-reference`](./references/gh-reference.md) reference for GitHub CLI (`gh`) operations.
