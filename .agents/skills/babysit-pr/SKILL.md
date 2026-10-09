---
name: babysit-pr
description: >-
  Synchronizes an open Pull Request with upstream main, processes inline review suggestions,
  diagnoses and fixes failing GitHub Actions checks while preserving PR intent, and verifies CI
  completion. Use when asked to babysit, sync, or make a PR green. Don't use for creating new PRs
  from scratch or reviewing PRs without fixing checks.
---

# Skill: babysit-pr

**Purpose**: Keep a Pull Request (PR) healthy by checking status actions, processing inline review suggestions, resolving merge conflicts with `upstream/main`, fixing failing checks while preserving the original intent of the PR, and verifying that CI completes cleanly.

### Prerequisites

- **GitHub CLI (`gh`)**: Verify authentication using `gh auth status`.
- **Active Checkout / Worktree**: Run all commands from within the checkout or worktree directory corresponding to the PR branch.

---

## Steps

### 1. Check Branch, PR Status, and Review Comments

- Verify the current branch:
  ```bash
  BRANCH_NAME=$(git branch --show-current)
  ```
- Retrieve the linked Pull Request details, issue comments, and inline review comments:
  ```bash
  PR_NUM=$(gh pr view --json number --jq '.number')
  gh pr view --json number,url,state,baseRefName,headRefName,title,body
  # Fetch general issue comments
  gh api repos/a2ui-project/a2ui/issues/$PR_NUM/comments --jq '.[] | {id: .id, author: .user.login, body: .body, created_at: .created_at}'
  # Fetch inline review comments
  gh api repos/a2ui-project/a2ui/pulls/$PR_NUM/comments --jq '.[] | {id: .id, author: .user.login, body: .body, created_at: .created_at, in_reply_to_id: .in_reply_to_id}'
  ```
- **Process Inline Action Commands**:
  - Check retrieved comments for instructions explicitly directed to the assistant:
    - Comments containing `"Agent: <task>"`.
    - Replies containing `"Do this"`, `"Apply this"`, or `"Agent: do this"` on a review comment that includes a suggested diff block (` ```suggestion `).
  - If an action command is found:
    - Delegate or execute the requested change in isolation, adhering to [`coding-principles`](../coding-principles/SKILL.md).
    - When applying a review suggestion, locate the target file and line range from the parent review comment, apply the suggested diff, and run local linting and unit tests to verify it.
    - Reply directly within the review comment thread (`gh api --method POST repos/a2ui-project/a2ui/pulls/comments/<comment_id>/replies -f body="<summary>"`) to confirm the change was applied. Do NOT post a generic top-level comment via `gh pr comment`.

---

### 2. Synchronize Branch with `upstream/main`

- Fetch the latest `main` branch from `upstream` (or `origin` if `upstream` is not configured):
  ```bash
  git fetch upstream main
  ```
- Check if the branch is behind `upstream/main`:
  ```bash
  git log HEAD..upstream/main --oneline
  ```
- If there are upstream changes to incorporate:
  - Stash any local uncommitted changes first:
    ```bash
    if [ -n "$(git status --porcelain)" ]; then
      git stash
    fi
    ```
  - **For Standalone Branches (Standard Merge)**:
    - Merge `upstream/main`:
      ```bash
      git merge upstream/main
      ```
    - **Resolve Merge Conflicts**:
      - Inspect conflicted files for conflict markers (`<<<<<<< HEAD` ... `=======` ... `>>>>>>> upstream/main`).
      - Combine the branch changes with the upstream changes, ensuring no conflict markers remain and no `CHANGELOG.md` version headers were dropped (see [`update-changelog`](../update-changelog/SKILL.md)).
      - Run local builds and tests for the affected languages (see Step 5) to verify the resolution.
      - Commit the merge:
        ```bash
        git add <resolved-files>
        git commit -m "Merge branch 'upstream/main' into $BRANCH_NAME"
        ```
      - If conflicts are ambiguous or alter architectural intent, run `git merge --abort` and ask the user for guidance.
  - **For Stacked PRs (Rebase Only, No Merge Commits)**:
    > [!IMPORTANT]
    > **Never run `git merge` on a stacked branch.** Stacked PRs must maintain a clean linear commit history per branch.
    - Rebase the branch onto `upstream/main` (or onto its updated parent branch in the stack):
      ```bash
      git rebase upstream/main
      ```
    - If the base PR of a stack has already merged into `main`, rebase the remaining branches in topological order onto `upstream/main` (`git rebase --onto upstream/main <old-base> <branch>`), retarget the new bottom PR's base branch to `main` (`gh pr edit <pr-num> --base main`), and force-push the updated branches with `--force-with-lease`.
  - Restore any stashed changes:
    ```bash
    git stash pop
    ```

---

### 3. Format, Verify PR Metadata, and Push Updates

- Verify that `CHANGELOG.md` in any modified package accurately reflects public API or behavioral changes (see [`update-changelog`](../update-changelog/SKILL.md)).
- If the PR scope evolved, keep the PR title (`gh pr edit <number> --title "..."`) and description (`gh pr edit <number> --body "..."`) synchronized with the diff.
- Run the repository formatter before pushing:
  ```bash
  ./scripts/fix_format.sh
  ```
- Push the updates to the remote branch tracking the PR:
  ```bash
  git push
  ```
- **Wait for Status Checks**: Pushing updates triggers GitHub Actions. Set a non-blocking timer (e.g. 180 seconds) or use `gh pr checks --watch` to allow the workflow runs to complete before inspecting results.

---

### 4. Inspect Status Checks & Actions

- List all check runs and their statuses:
  ```bash
  gh pr checks
  ```
- **If all checks pass** and the branch is up to date with `upstream/main`, proceed to Step 6.
- **If any checks fail**:
  - Identify the failing job IDs and inspect their failure logs:
    ```bash
    gh run view --log-failed
    ```
    or for a specific job:
    ```bash
    gh run view --job=<job-id> --log
    ```

---

### 5. Fix Failing Checks Using Language-Specific Guides and Verification

Analyze the failure logs while preserving the **original intent of the PR**. Before editing code or running local verification, route by the language of the failing check:

| Failing Check / Ecosystem                                                                           | Progressive Discovery Skill & Local Verification Commands                                                                                                                               |
| :-------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Formatting & Markdown Links**                                                                     | Run `./scripts/fix_format.sh` and verify all relative markdown links resolve to existing files in the repository.                                                                       |
| **TypeScript / Web (`typescript/`, `renderers/`, `samples/client/{lit,angular,react}/`, `tools/`)** | Load [`coding-principles/subskills/typescript/INDEX.md`](../coding-principles/subskills/typescript/INDEX.md). Run `yarn build`, `yarn lint`, and `yarn test` in the affected workspace. |
| **Python (`python/`, `eval/`, `samples/agent/`, `scripts/`)**                                       | Load [`a2ui-python-development`](../a2ui-python-development/SKILL.md). Run `uv run pytest` in the affected Python package directory.                                                    |
| **Swift (`swift/`, `Package.swift`)**                                                               | Load [`a2ui-swift-development`](../a2ui-swift-development/SKILL.md). Run `swift build` and `swift test`.                                                                                |
| **Dart / Flutter (`dart/`, `samples/client/flutter/`)**                                             | Load [`a2ui-dart-versioning`](../a2ui-dart-versioning/SKILL.md) (if changelog/versioning). Run `dart analyze` and `flutter test` (or `dart test`) in the affected package.              |

After verifying the fix locally:

1. Update `CHANGELOG.md` if the fix alters public APIs or consumer-visible behavior (see [`update-changelog`](../update-changelog/SKILL.md)).
2. Format, commit, and push:
   ```bash
   ./scripts/fix_format.sh
   git add -u
   git commit -m "fix: resolve failing CI check (<concise summary>)"
   git push
   ```
3. Wait for the re-triggered GitHub Actions checks to finish and return to Step 4.

---

### 6. Completion Criteria

The task is complete when `gh pr checks` reports all required checks passing and the branch is up to date with `upstream/main`.
