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

### Step 3: Choose Destination & Create Workspace / Branch

1. Check with the user on where they would like the changes created and what branch name to use:
   - **Default recommendation**: Create a new git worktree with a clean branch based on `upstream/main` (e.g., `git worktree add ../remediation_issue_${ISSUE_NUMBER}_${RECOMMENDATION_INDEX} -b remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX} upstream/main`).
   - Alternatively, create a branch in the current worktree or apply changes in place if requested.
2. Note the chosen branch name in `BRANCH_NAME` (e.g. `remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}` or a custom descriptive topic name).
3. Ensure the working tree is clean and up to date with `upstream/main`.

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

### Step 5: Create Draft PR & Notify Issue (Optional / Upon Request)

1. Check if the user wants to submit a Draft PR.
2. Generate a clear, descriptive PR title following Conventional Commits that concisely explains the specific fix being made (e.g. `fix(swift): create missing top-level README in swift/core`). **Do NOT include generic issue or recommendation numbers in the PR title.**
3. Draft the PR description into a temporary file `pr_description.md` following [pr-description-template.md](references/pr-description-template.md).
4. Push the branch to `origin` (or user's fork) and create a Draft Pull Request against `main`:
   ```bash
   git push -u origin "${BRANCH_NAME}"
   PR_URL=$(gh pr create --draft \
     --repo a2ui-project/a2ui \
     --head "${BRANCH_NAME}" \
     --base main \
     --title "${PR_TITLE}" \
     --body-file pr_description.md)
   ```
   *(Note: If pushing from a fork, `gh pr create` automatically resolves the fork's head branch or accepts `--head <username>:${BRANCH_NAME}`.)*
5. Clean up the temporary file `pr_description.md`.
6. Comment on the original issue to notify maintainers of the new Draft PR:
   ```bash
   gh issue comment "${ISSUE_NUMBER}" \
     --repo a2ui-project/a2ui \
     --body "🤖 Automated remediation triggered! Created draft PR (${PR_URL}) on branch \`${BRANCH_NAME}\` to address recommendation ${RECOMMENDATION_INDEX}."
   ```

---

## **References**

- Refer to the [PR description template](references/pr-description-template.md) for PR body structure and guidelines.
- Refer to the [`gh-reference`](../a2ui-audit/references/gh-reference.md) for GitHub CLI commands.
