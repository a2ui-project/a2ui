---
name: a2ui-remediate-problem
description: Remediates a specific recommendation from an A2UI compliance report issue by inspecting context, implementing minimal targeted fixes, verifying tests, creating a branch, and opening a developer-signed Draft Pull Request. Use when asked to fix or remediate an A2UI compliance audit finding or recommendation.
---

# A2UI Compliance Remediation Skill

This skill guides an AI coding agent or engineer on how to remediate a specific recommendation from an A2UI compliance report issue and submit a clean, developer-signed Draft Pull Request.

---

## **Workflow**

Follow these steps to remediate an issue recommendation:

### Step 1: Read Issue Context

1. Retrieve the recommendation context using the helper script or `gh` CLI:
   ```bash
   python3 .agents/skills/a2ui-remediate-problem/scripts/extract_recommendation.py "${ISSUE_NUMBER}" "${RECOMMENDATION_INDEX}" --json
   ```
   Alternatively, view the raw issue body directly:
   ```bash
   gh issue view "${ISSUE_NUMBER}" --repo a2ui-project/a2ui --json body --jq '.body'
   ```
2. Locate recommendation item `${RECOMMENDATION_INDEX}` under `## Recommendations`.
3. Review the surrounding audit sections in the report (such as `## Codebase Blueprint Compliance Audit`, `## Code & Documentation Sync Audit`, or `## Test Quality & Assertions Audit`) for specific details, line numbers, and discrepancy reasons.

---

### Step 2: Formulate & Apply Remediation

1. Identify the files and codebases referenced by recommendation `${RECOMMENDATION_INDEX}`.
2. Carefully inspect the current source code, documentation, or blueprint files.
3. Implement the minimal necessary change to remediate the reported problem.
   - **CRITICAL RULE**: Do not make unrelated changes, refactorings, or formatting edits outside the scope of recommendation `${RECOMMENDATION_INDEX}`.
4. If modifying Python code or scripts, format the modified files:
   ```bash
   uv run pyink .
   ```
5. If modifying tests or scripts, execute local tests across the affected packages to ensure no regressions were introduced.

---

### Step 3: Create Branch

1. Fetch latest `main` from upstream/origin:
   ```bash
   git fetch upstream main || git fetch origin main
   ```
2. Create and checkout a clean branch named `remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}` based on `upstream/main` (or `origin/main`):
   ```bash
   git checkout -b "remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}" upstream/main
   ```

---

### Step 4: Commit Changes

1. Stage all modified files relevant to the remediation:
   ```bash
   git add -u
   ```
2. Create a conventional commit referencing the issue number:
   ```bash
   git commit -m "fix(compliance): remediate issue #${ISSUE_NUMBER} recommendation ${RECOMMENDATION_INDEX}"
   ```

---

### Step 5: Create Draft PR & Notify Issue

1. Generate a clear, descriptive PR title following the Conventional Commits format that concisely explains the specific fix being made (e.g. `fix(swift): create missing top-level README in swift/core`). **Do NOT include generic issue or recommendation numbers in the PR title.**
2. Draft the PR description into a temporary file `pr_description.md` following the guidelines and structure in [pr-description-template.md](references/pr-description-template.md). Ensure that `${ISSUE_NUMBER}` and `${RECOMMENDATION_INDEX}` are referenced in the `## Summary` section.
3. Push the branch to your fork / origin and create a Draft Pull Request against `main`:
   ```bash
   git push -u origin "remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}"
   PR_URL=$(gh pr create --draft \
     --repo a2ui-project/a2ui \
     --head "remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}" \
     --base main \
     --title "${PR_TITLE}" \
     --body-file pr_description.md)
   ```
4. Clean up the temporary PR description file:
   ```bash
   rm -f pr_description.md
   ```
5. Comment on the original issue to notify maintainers of the new Draft PR and branch:
   ```bash
   gh issue comment "${ISSUE_NUMBER}" \
     --repo a2ui-project/a2ui \
     --body "🤖 Automated remediation triggered! Created draft PR (${PR_URL}) on branch \`remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}\` to address recommendation #${RECOMMENDATION_INDEX}."
   ```

---

## **References**

- Refer to the [PR description template](references/pr-description-template.md) for PR body structure and guidelines.
- Refer to the [`gh-reference`](../a2ui-audit/references/gh-reference.md) for GitHub CLI commands.
