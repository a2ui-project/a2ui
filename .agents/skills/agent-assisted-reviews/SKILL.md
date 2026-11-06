---
name: agent-assisted-reviews
description: >-
  Conducts specification-grounded code reviews on pull requests. Analyzes alignment with
  blueprints, identifies high-risk areas vs. skimmable code, and posts concise, human-styled
  line-by-line review comments.
---

# Agent-Assisted Pull Request Review Skill

Use this skill when asked to *"help me review PR X"*, *"review PR X"*, or when conducting a
code review on a pull request or branch.

This skill equips an assistant to analyze pull requests, verify alignment with A2UI protocol
specifications and blueprints, produce a human review roadmap (highlighting what to scrutinize
versus what can be skimmed), and draft or post line-by-line review comments formatted like
natural human feedback.

---

## Review Workflow

### Step 1: Ingest PR Context & Changes

1. Fetch PR metadata, description, base branch, head branch, and diff:
   ```bash
   gh pr view <pr_number> --json baseRefName,headRefName,title,body,url,headRefOid
   git diff <base_branch>...HEAD
   ```
2. Identify affected subsystems, languages, and protocol versions (`v0.9`, `v0.9.1`, `v1.0`).

---

### Step 2: Blueprint & Specification Alignment

Audit changes against authoritative specifications and module blueprints:

1. **Protocol Specifications ([`specification/`](../../../specification/))**:
   - Compare wire formats and envelope invariants against canonical JSON schemas.
   - Verify strict version checking and schema validity.
2. **Module Blueprints ([`blueprints/modules/`](../../../blueprints/modules/))**:
   - Verify architectural boundaries and module responsibilities (e.g.,
     [`a2ui_core.blueprint.md`](../../../blueprints/modules/a2ui_core.blueprint.md)).
3. **Design Decisions & Ambiguities**:
   - **Conflicting Design Decisions**: Explicitly point out any instance where the PR makes a
     design choice that conflicts with blueprints or specifications.
   - **Ambiguous Specs**: Where the specification or blueprint is ambiguous or underspecified,
     identify the specific interpretation chosen by the author.
   - **Resolution Path**: Note whether the ambiguity requires close human review or should trigger
     a follow-up PR to update the specification or blueprint to remove ambiguity permanently.
4. **Cross-Language Reference Parity**:
   - Compare behavior with canonical reference implementations (e.g.,
     [`typescript/web_core/`](../../../typescript/web_core/) or
     [`python/a2ui_core/`](../../../python/a2ui_core/)) to ensure cross-SDK parity.
5. **Breaking Changes & Behavioral Shifts**:
   - Check for modifications that could break existing client applications or protocol peers.
   - Look for subtle breaking changes: altered default parameter values, modified fallback
     behaviors, expanded or retyped enum cases, changes to error types/codes, serialization
     defaults that drop support for older versions, or tighter validation rejecting previously
     valid payloads.
   - Breaking changes should be avoided where possible. When unavoidable, ensure they are flagged
     for close human review and accompanied by clear changelog notes and migration steps.

---

### Step 3: Generate the Human Review Guide

Present a structured review roadmap to the human reviewer dividing the PR into what needs close
attention versus what can be safely skimmed:

#### 1. Files & Changes to Focus on Closely (and Why)
* **Public APIs**: Any new or modified types, methods, or protocols that application code can
  call directly. Look for redundant or competing entry points.
* **Breaking Changes to APIs & Behavior**:
  - Any modifications to public APIs, protocol wire formats, or runtime semantics that could
    break existing client applications or peer agents.
  - Watch for subtle regressions: changing default parameter values, altering fallback logic,
    expanding non-exhaustive enums or changing enum case types, modifying error types/codes,
    changing serialization defaults (e.g., unconditionally emitting a newer protocol version to
    peers that negotiated an older one), or enforcing stricter validation on previously accepted
    payloads.
  - Breaking changes should be avoided where possible, reviewed with extreme care, and
    accompanied by clear changelog notes and migration guidance.
* **Security-Critical Implementations**:
  - Prototype pollution guards (`__proto__`, `constructor`, `prototype`).
  - Caller authorization (`allowedCallers`: `rendererOnly`, `agentOnly`, `both`).
  - User activation context checks (`requiresUserActivation`) before sensitive local actions.
  - Cycle detection and recursion depth limits preventing stack overflow / DoS.
  - Async cancellation, timeout handlers, and continuation leak prevention.
* **New Architectural Decisions & Packaging**:
  - Novel abstractions, dependencies, or communication patterns.
  - Packaging hygiene: ensure schemas and assets are bundled via standard package mechanisms
    (e.g., package resource bundles, embedded constants, or build-time code generation)
    rather than unsafe runtime filesystem traversals that fail when packaged as binary
    dependencies or deployed to production environments.
* **Spec / Blueprint Divergences & Ambiguities**: Where the PR chose a specific approach to an
  ambiguous requirement or diverged from the spec.
* **Untested Code Paths**: Code not covered by cross-language conformance test suites under
  [`conformance/`](../../../conformance/) (listing what unit tests cover them or flagging gaps).

#### 2. Sections That Can Be Skimmed (and Why)
Briefly list files and components that do not need deep scrutiny, for example:
* **Heavily Tested Core Code**: Logic covered exhaustively by language-agnostic conformance tests.
* **Highly Blueprint-Constrained Code**: Standard implementations strictly conforming to blueprint
  recipes without novel design choices.
* **Pure Test Code & Fixtures**: Conformance test runners, mock objects, or embedded test golden
  data.
* **Sample & Demo Code**: Non-production client apps (e.g., in `samples/`).
* **Mechanical Changes**: Systematic renames, imports, or formatting changes.

---

### Step 4: Line-by-Line Review Comments

When drafting or posting review comments generated by an assistant:

1. **Human Review Before Posting**:
   - Any comments suggested by an assistant MUST typically be reviewed and approved by the human
     reviewer before they are posted to the pull request.
   - Present the proposed inline comments in your response or in a review summary for the human to
     inspect, refine, or approve. Only proceed with posting them to the PR when the human reviewer
     explicitly confirms or directs you to do so.
2. **Post Line-by-Line on Relevant Diff Lines**:
   - Comments must be anchored to the specific lines and files where the issue occurs, rather than
     lumped into a generic top-level PR comment.
3. **Format Similar to Human Comments**:
   - **Start in plain text without headings**: Do not start with markdown headings (e.g., avoid
     `### Title`). State the problem and actionable fix conversationally and directly.
   - **Use `<details>` for Extra Context**: Put additional details, code snippets, suggested
     implementations, or documentation links inside a collapsible `<details>` block so humans can
     skim the conversation easily without visual clutter.

#### Comment Template

```markdown
Brief, direct explanation of the issue and why it matters in plain text. Actionable suggested
fix or direction.

<details>
<summary>Details and suggested fix</summary>

```<language>
// Concrete replacement code or implementation example
```
</details>
```
