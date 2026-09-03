# A2UI Issue Triage Criteria & Guidelines

This document defines the operational execution rules for classifying issues, assigning priorities, recommending owners, and drafting responses.

---

## Canonical Sources of Truth

Refer directly to the project documentation for authoritative definitions and canonical response templates:

- **Priority Definitions & Invariants**: [docs/contributing/triage.md](../../../../docs/contributing/triage.md#invariant-we-want-to-keep) (`P0` through `P4`).
- **GitHub Status Labels**: [docs/contributing/triage.md](../../../../docs/contributing/triage.md#github-labels-used-in-triage) (`status: first-line-handled`, `status: waiting-for-author-response`, `status: needs-team-input`, `status: needs-triage`).
- **Canonical Response Templates**: [docs/contributing/triage-templates.md](../../../../docs/contributing/triage-templates.md) (Standard replies for requesting information, compliance reports, assigned issues without priority, stale issue pings, duplicates, and out-of-scope requests).

---

## Issue Classification & Operational Action Flows

All triaged issues must be tagged with the `status: first-line-handled` label.

### 1. Bug Reports

- **Analysis**:
  - **Reproduction**: Do not attempt local reproduction unless the steps are simple, clear, and the environment can be set up immediately. If you need to check out the branch or clone the PR repo to reproduce the issue, do it in a temporary clone or git worktree (e.g. in `<appDataDir>/brain/<conversation-id>/scratch/issue_12345_repro/`).
  - **Static Analysis**: For complex bugs, analyze the logs, stack traces, and relevant specification files (e.g., JSON schemas in `specification/`) to diagnose the issue.
- **Action**:
  - If reproduction steps or logs are missing, set action to `needs_info`, apply the `status: waiting-for-author-response` label, and use the [Requesting Information template](../../../../docs/contributing/triage-templates.md).
  - If verified, suggest the appropriate priority (`P0` to `P3`) and recommend the owner of the affected component based on path mapping (e.g., paths with `renderers/lit` belong to the Lit renderer maintainer, `specification/` to the specification maintainer) and file commit history (`git log -n 5 --format="%ae" <file>`).
  - Clean up any temporary files, worktrees, or clones when finished.

### 2. Feature Requests

- **Analysis**:
  - Verify if the request aligns with the [A2UI roadmap](../../../../docs/public/roadmap.md) and design philosophy for the affected components.
- **Action**:
  - If aligned, set action to `backlog` with priority `P2` or `P3` and suggest component/type labels (e.g., `component: standard catalog specification`, `type: feature/enhancement`).
  - If out of scope, set priority to `P4` and action to `backlog` (keeping the issue open). Draft the response using the [Out of Scope template](../../../../docs/contributing/triage-templates.md#out-of-scope--roadmap-conflict).

### 3. Support Requests and Questions

- **Analysis**:
  - Identify if the issue is a question about usage or setup rather than a bug.
- **Action**:
  - Set action to `close_resolved` or `close_invalid`.
  - Answer the question directly or provide links to relevant guides (e.g., [quickstart.md](../../../../docs/public/quickstart.md)) or GitHub Discussions, then close the issue.

---

## Response Guidelines

When drafting replies, always copy the exact response text from [docs/contributing/triage-templates.md](../../../../docs/contributing/triage-templates.md).

- **Be direct**: State the action being taken or what is needed immediately.
- **Eliminate fluff**: Do not use conversational filler (e.g., "I hope this helps").
- **Refer to templates**: Keep draft comments synchronized with canonical templates.
