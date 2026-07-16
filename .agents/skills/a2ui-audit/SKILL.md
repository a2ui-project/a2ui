---
name: a2ui-audit
description: Main coordination skill to run the blueprint compliance, documentation synchronization, and test quality audits, posting the combined results as a labeled GitHub issue.
---

# A2UI Compliance Verification Skill

This skill coordinates the execution of specification compliance, documentation
sync, and test quality audits, and publishes the combined results to the GitHub
repository.

Other than writing a report and creating an issue, this skill is purely a
read-only skill; no changes are to be made to the codebase. Do not attempt to
fix issues.

---

## **Instructions**

1. **Audit Codebase Blueprint Compliance**:
   - Run the sub-skill [`a2ui-blueprint-compliance`](../../../blueprints/skills/a2ui-blueprint-compliance/SKILL.md) to generate the Markdown report of codebase blueprint statuses.
   - Save the returned Markdown report to a temporary file in the workspace (e.g., `compliance_report.md`) under the header `## Codebase Blueprint Compliance Audit`.

2. **Audit Code vs. Documentation Synchronization**:
   - Run the sub-skill [`a2ui-doc-sync-check`](../a2ui-doc-sync-check/SKILL.md) to audit documentation drift (docs, READMEs, docstrings/comments).
   - Append the returned Markdown report to `compliance_report.md` under a new header `## Code & Documentation Sync Audit`.

3. **Audit Test Quality & Assertion Strength**:
   - Run the sub-skill [`a2ui-test-quality-check`](../a2ui-test-quality-check/SKILL.md) to audit test suites for weak assertions and behavioral verification.
   - Append the returned Markdown report to `compliance_report.md` under a new header `## Test Quality & Assertions Audit`.

4. **Summarize the report**:
   - Add a `## Summary` section at the top of the `compliance_report.md` file that includes a brief overview of what was checked, and a `## Recommendations` section with a list of recommendations for follow-up actions, ordered by priority.

5. **Publish Report**:
   - Execute the local Python helper script to create the GitHub issue containing the combined reports:
     ```bash
     python3 .agents/skills/a2ui-audit/scripts/create_compliance_report.py compliance_report.md --repo a2ui-project/a2ui
     ```
   - Ensure the helper script runs successfully.
   - Clean up the temporary file `compliance_report.md` after completion.

---

## **References**

- Refer to the [`a2ui-blueprint-compliance`](../../../blueprints/skills/a2ui-blueprint-compliance/SKILL.md) skill for codebase blueprint checking.
- Refer to the [`a2ui-doc-sync-check`](../a2ui-doc-sync-check/SKILL.md) skill for documentation sync checking.
- Refer to the [`a2ui-test-quality-check`](../a2ui-test-quality-check/SKILL.md) skill for test quality and assertion checking.
- Refer to the [`gh-reference`](./references/gh-reference.md) reference for GitHub CLI (`gh`) operations.
