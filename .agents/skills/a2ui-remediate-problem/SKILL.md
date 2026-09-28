---
name: a2ui-remediate-problem
description: Remediates a specific recommendation from an A2UI compliance report issue, or resolves any general GitHub issue, by inspecting context, implementing minimal targeted fixes, verifying tests, creating a branch, and opening a developer-signed Pull Request. Use when asked to fix or remediate an A2UI compliance audit finding, recommendation, or repository issue.
---

# A2UI Issue & Compliance Remediation Skill

This skill guides an AI coding agent or engineer on how to remediate a specific recommendation from an A2UI compliance report or resolve any general repository issue and submit a clean, developer-signed Pull Request.

---

## **Workflow**

Follow these steps to remediate an issue:

### Step 1: Identify & Read Issue Context

1. **Determine the Target Issue**:
   - If the user provided an issue number or URL in their request, extract `ISSUE_NUMBER`.
   - If no issue was specified, ask the user (prefer using the `ask_question` tool):
     _"Which GitHub issue would you like to remediate? (Please provide the issue number or URL, e.g. 2391)"_

2. **Retrieve Context & Determine Issue Type**:
   - Run the helper script to inspect the issue:
     ```bash
     python3 .agents/skills/a2ui-remediate-problem/scripts/extract_recommendation.py "${ISSUE_NUMBER}" [RECOMMENDATION_INDEX] --json
     ```
   - **Scenario A: Compliance Report with Multiple Recommendations**:
     - If a recommendation index was provided (e.g. `2`), the script extracts that item's details and priority.
     - If no recommendation index was specified, the script outputs all available recommendations in the issue. Ask the user (via `ask_question`) which recommendation item they would like to address.
     - Review the surrounding audit sections in the report (such as `## Codebase Blueprint Compliance Audit`, `## Code & Documentation Sync Audit`, or `## Test Quality & Assertions Audit`) for detailed findings.
   - **Scenario B: General Issue (Bug Report, Feature Request, or Non-Audit Issue)**:
     - If the issue is not a compliance report, the script returns the issue title and body as the problem statement to remediate.

---

### Step 2: Formulate & Apply Remediation

1. Identify the files and codebases referenced by the issue or recommendation.
2. Carefully inspect the current source code, documentation, or blueprint files.
3. Implement the minimal necessary change to remediate the reported problem.
   - **CRITICAL RULE**: Do not make unrelated changes, refactorings, or formatting edits outside the scope of the target issue or recommendation.
4. Format modified files and ensure code style compliance:
   ```bash
   ./scripts/fix_format.sh
   ```
5. If modifying tests or scripts, execute local tests across the affected packages to ensure no regressions were introduced.

---

### Step 3: Choose Destination & Create Workspace / Branch

1. Check with the user on where they would like the changes created and what branch name to use (prefer using the `ask_question` tool or equivalent interactive tool if available):
   - **Recommended branch name**: `remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}` (or `remediation/issue-${ISSUE_NUMBER}` for general issues).
   - Let the user choose whether to create a separate git worktree (using their preferred local worktree conventions), checkout a new branch in the current directory, or apply changes in place.
2. Note the chosen branch name in `BRANCH_NAME`.
3. Ensure the working tree is clean and up to date with `upstream/main`.

---

### Step 4: Commit Changes

1. Stage all modified files relevant to the remediation:
   ```bash
   git add -u
   ```
2. Create a conventional commit referencing the issue number:
   - For compliance recommendations:
     ```bash
     git commit -m "fix(compliance): remediate issue #${ISSUE_NUMBER} recommendation ${RECOMMENDATION_INDEX}"
     ```
   - For general issues:
     ```bash
     git commit -m "fix(scope): remediate issue #${ISSUE_NUMBER} - ${CONCISE_SUMMARY}"
     ```

---

### Step 5: Create Pull Request & Notify Issue (Optional / Upon Request)

1. Check with the user whether they would like to submit a Pull Request (prefer using the `ask_question` tool or equivalent interactive tool if available):
   - **Recommended default**: Submit as a Draft PR (`--draft`) so CI checks run while allowing final review before requesting maintainer approvals.
   - Alternatively, submit directly as ready for review, or skip PR creation if the user wants to inspect changes locally first.
2. If submitting a PR, generate a clear, descriptive PR title following Conventional Commits that concisely explains the specific fix being made (e.g. `fix(swift): create missing top-level README in swift/core`). **Do NOT include generic issue or recommendation numbers in the PR title.**
3. Draft the PR description into a temporary file `pr_description.md` following [pr-description-template.md](references/pr-description-template.md).
4. Push the branch to `origin` (or user's fork) and create the Pull Request against `main`:
   ```bash
   git push -u origin "${BRANCH_NAME}"
   PR_URL=$(gh pr create --draft \
     --repo a2ui-project/a2ui \
     --head "${BRANCH_NAME}" \
     --base main \
     --title "${PR_TITLE}" \
     --body-file pr_description.md)
   ```
   _(Note: Omit `--draft` if the user prefers an immediate ready-for-review PR. If pushing from a fork, `gh pr create` automatically resolves the fork's head branch or accepts `--head <username>:${BRANCH_NAME}`.)_
5. Clean up the temporary file `pr_description.md`.
6. Comment on the original issue to notify maintainers of the new PR:
   ```bash
   gh issue comment "${ISSUE_NUMBER}" \
     --repo a2ui-project/a2ui \
     --body "🤖 Automated remediation triggered! Created PR (${PR_URL}) on branch \`${BRANCH_NAME}\` to address recommendation ${RECOMMENDATION_INDEX}."
   ```

---

## **References**

- Refer to the [PR description template](references/pr-description-template.md) for PR body structure and guidelines.
- Refer to the [`gh-reference`](../a2ui-audit/references/gh-reference.md) for GitHub CLI commands.
