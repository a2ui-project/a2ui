# Automated Remediation Draft PR Playbook

This reference playbook instructs an automated agent on how to remediate a specific recommendation from an A2UI compliance report issue and submit a Draft Pull Request.

---

## Prerequisites & Environment

The agent execution environment must provide the following environment variables:

- `ISSUE_NUMBER`: The GitHub Issue number of the compliance report (e.g., `2138`).
- `RECOMMENDATION_INDEX`: The 1-based index of the recommendation item to address (e.g., `1`).
- `GITHUB_TOKEN`: A token with `contents: write`, `pull-requests: write`, and `issues: write` permissions.

---

## Instructions

### Step 1: Read Issue Context

1. Retrieve the text of the target compliance report issue from GitHub:
   ```bash
   gh issue view "${ISSUE_NUMBER}" --repo a2ui-project/a2ui --json body --jq '.body'
   ```
2. Locate the `## Recommendations` section and identify the item corresponding to index `${RECOMMENDATION_INDEX}`.
3. Review the surrounding report sections (such as `## Codebase Blueprint Compliance Audit`, `## Code & Documentation Sync Audit`, or `## Test Quality & Assertions Audit`) for detailed context on why this item was flagged.

---

### Step 2: Formulate & Apply Remediation

1. Identify the files and codebases referenced by recommendation `${RECOMMENDATION_INDEX}`.
2. Carefully inspect the current source code, documentation, or blueprint files.
3. Implement the minimal necessary change to remediate the reported problem.
   - **CRITICAL RULE**: Do not make unrelated changes, refactorings, or formatting edits outside of the scope of recommendation `${RECOMMENDATION_INDEX}`.
4. If modifying Python code or scripts, format the modified files:
   ```bash
   uv run pyink .
   ```
5. If modifying tests or scripts, execute local tests to ensure no regressions were introduced.

---

### Step 3: Configure Git & Create Branch

1. Configure git bot identity and HTTP authorization header:
   ```bash
   git config user.name "github-actions[bot]"
   git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
   git config http.extraheader "AUTHORIZATION: bearer ${GITHUB_TOKEN}"
   ```
2. Fetch `main` and create a clean branch named `remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}` based on `origin/main`:
   ```bash
   git fetch origin main
   git checkout -b "remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}" origin/main
   ```

---

### Step 4: Commit and Push

1. Stage all modified files relevant to the remediation:
   ```bash
   git add -u
   ```
2. Create a conventional commit referencing the issue number:
   ```bash
   git commit -m "fix(compliance): remediate issue #${ISSUE_NUMBER} recommendation ${RECOMMENDATION_INDEX}"
   ```
3. Push the branch to the origin repository:
   ```bash
   git push origin "remediation/issue-${ISSUE_NUMBER}-${RECOMMENDATION_INDEX}"
   ```

---

### Step 5: Create Draft PR & Notify Issue

1. Generate a clear, descriptive PR title following the Conventional Commits format that concisely explains the specific fix being made (e.g. `fix(swift): create missing top-level README in swift/core`). **Do NOT include generic issue or recommendation numbers in the PR title.**
2. Draft the PR description into a temporary file `pr_description.md` following the exact guidelines and structure in `.agents/skills/a2ui-audit/references/pr-description-template.md`. Ensure that `${ISSUE_NUMBER}` and `${RECOMMENDATION_INDEX}` are referenced in the `## Summary` section of the body and the local checkout/inspection block is included.
3. Create a Draft Pull Request against the `main` branch using `--title` and `--body-file`:
   ```bash
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
