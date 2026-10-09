# Subskill: PR Hygiene, Atomicity, Scope Control & Software Design

## Activation Criteria

Activate this subskill for:

- All pull requests during code authoring, review, or PR preparation.
- PRs that touch multiple functional domains, bundle features with refactoring, or include non-essential changes.
- Large diffs that could be split or stacked to improve logical isolation and review velocity.
- PRs introducing incidental edits to tooling, package scripts, formatting, or license headers.
- Architectural changes introducing new modules, interfaces, or comments.

---

## Principles

### 1. Enforce Atomic, Minimal PRs for Review Velocity

- **Problem & Rationale**: Large, monolithic pull requests overwhelm human reviewers, increase merge conflict risks, delay reviews, and make post-merge debugging or bisecting painful. PRs must be atomic and as minimal as possible to facilitate quick, high-confidence reviews.
- **Actionable Guidance**:
  - Keep each PR scoped to a single logical objective.
  - If a change is becoming broad, split it into smaller, logically isolated PRs.
  - Stack split PRs (for example with `gh stack`) when changes build sequentially upon one another, improving logical isolation while maintaining developer flow.
- **Reviewer / Agent Checklist**:
  - [ ] Is this PR atomic and minimal? Can it be reviewed thoroughly in under 15 minutes?
  - [ ] Could this PR be split into smaller, stacked PRs to improve logical isolation and review velocity?

---

### 2. Never Bundle Features with Unrelated Refactoring

- **Problem & Rationale**: Bundling "feature X" with "a bit of refactoring in module Y" (or even refactoring within the same module) conflates behavioral changes with structural adjustments. Reviewers cannot easily distinguish intentional functional changes from refactoring artifacts, increasing the risk of subtle regressions slipping through.
- **Actionable Guidance**:
  - Separate features and refactorings into independent PRs.
  - PRs should strictly contain only the changes required to fulfill their specific objective.
  - If a refactoring is required to support a new feature, implement the refactoring first in a dedicated PR (or foundational stacked layer), verify all existing tests pass, and then implement the feature in a separate PR on top.
- **Reviewer / Agent Checklist**:
  - [ ] Flag any refactoring, structural cleanup, or renaming bundled into a feature PR.
  - [ ] Request separating the feature and the refactoring into two independent PRs.

---

### 3. Eliminate Unrelated Tooling, License Header, and Formatting Noise

- **Problem & Rationale**: Incidental edits, such as updating copyright years on untouched files, tweaking package manager wrappers, reformatting untouched lines, or modifying unrelated build scripts, distract reviewers, inflate diff size, and create misleading `git blame` history.
- **Actionable Guidance**:
  - Revert any unsolicited copyright year updates on untouched files.
  - Confine formatting changes strictly to the code lines being modified.
  - Do not modify repository tooling, package manager wrappers, or shared build scripts unless that is the explicit objective of the PR.
- **Reviewer / Agent Checklist**:
  - [ ] Revert unsolicited copyright year updates and script wrapper tweaks in existing files.
  - [ ] Ensure formatting changes are strictly confined to modified code.

---

### 4. Self-Contained Descriptions & Independent CI Validation

- **Problem & Rationale**: Reviewers evaluate PRs individually. PR descriptions with missing context or commits that break CI midway through a series stall review cycles and block CI pipelines.
- **Actionable Guidance**:
  - Write a clear, self-contained PR description that details the specific problem, solution, and verification steps for this PR alone.
  - Avoid relying on ephemeral stack metadata (e.g., avoid "Part 2 of 5" or "stacked on top of #123").
  - When a PR modifies the public API or consumer-facing behavior of a published package, update its `CHANGELOG.md` following [`update-changelog.md`](update-changelog.md).
  - Ensure the PR compiles cleanly and passes all format checks, lints, and unit tests independently before requesting review.
- **Reviewer / Agent Checklist**:
  - [ ] The PR description clearly explains the motivation, changes, and verification steps independently.
  - [ ] All CI checks (formatting, linting, unit tests) pass cleanly for this PR alone.

---

### 5. Comment Only What the Code Cannot Say

- **Problem & Rationale**: Comments that restate the code or the identifier, or that repeat the PR description in every file, add reading time without adding information, and drift out of date.
- **Actionable Guidance**:
  - Add a comment only when it explains a line or block that is hard to understand on its own, or the reasoning behind a decision, invariant, or tradeoff that is not obvious from the code.
  - Keep docstrings and JSDoc blocks focused on what a caller needs: what the symbol is for and any contract the signature does not show. Do not echo parameter names or types that are already in the type signature.
  - State a shared design once (in the module header or PR description); do not repeat it per symbol.
  - Prefer a clearer identifier or a smaller helper function over a comment that explains a confusing one.
- **Reviewer / Agent Checklist**:
  - [ ] Every added comment states something the code itself does not.
  - [ ] Docstrings and JSDoc blocks are concise and free of restated type signatures.

---

### 6. Prefer Deep Modules and Reduce System Complexity

- **Problem & Rationale**: Shallow modules that expose complex configuration or internal mechanics for minimal functionality increase cognitive load across the codebase. Similarly, tactical quick patches that shift complexity from one caller to another accumulate technical debt.
- **Actionable Guidance**:
  - **Prefer Deep Modules**: Design simple, narrow, and predictable public interfaces that hide meaningful implementation complexity behind a clean abstraction.
  - **Reduce Complexity, Don't Move It**: Avoid fixes that merely relocate complexity or make future changes harder; decrease overall system complexity.
  - **Obvious Design**: Choose naming and structure that make the design and intent obvious at the call site.
  - **Strategic over Tactical Changes**: Favor strategic designs that solve the root cause cleanly over tactical patches that work around the immediate symptom.
- **Reviewer / Agent Checklist**:
  - [ ] Does the module expose a narrow, predictable interface relative to the complexity it encapsulates?
  - [ ] Does the change reduce overall complexity rather than pushing burden onto callers?
