# A2UI Issue Triage Criteria & Guidelines

This document defines the rules and guidelines for classifying issues, assigning priorities, recommending owners, and formulating professional responses for the A2UI repository.

---

## Priority Definitions

Priorities in A2UI represent the team's commitment and timeline for addressing an issue:

- **P0 (Urgent)**: Urgent issue. Should always have an assignee.
  - _Scope_: Severe security vulnerabilities, or broken protocol behavior that affects many clients, or major regressions that block an active release.
  - _Action_: Assign immediately.
- **P1 (High)**: This is a priority. Team is actively working on it, or will be soon. Should always have an assignee.
  - _Scope_: Core features broken, severe performance jank (such as browser rendering freezes), or bugs that affect many users with no clear workaround.
  - _Action_: Targeted for resolution in the active release or upcoming milestone. Assign immediately.
- **P2 (Medium)**: The team intends to work on this in the near future (expected to convert to P1 within quarter as part of regular planning process).
  - _Scope_: Standard bugs with known workarounds, or feature enhancements.
  - _Action_: Planned for upcoming milestones.
- **P3 (Low)**: Good request. This is not currently planned, but contributions are welcome.
  - _Scope_: Minor UI adjustments, aesthetic improvements, or edge-case bugs affecting very few developers.
  - _Action_: Open for community contributions. Core developers will not actively work on these.
- **P4 (Unplanned)**: We do not plan to invest into it, no PRs will be reviewed.
  - _Scope_: Feature requests or changes that fall outside the current scope of the roadmap.
  - _Action_: Keep open as a record of the request with priority `P4` and action `backlog`.

---

## Issue Classification and Action Flows

All triaged issues must be tagged with the `status: first-line-handled` label.

### 1. Bug Reports

- **Analysis**:
  - **Reproduction**: Do not attempt local reproduction unless the steps are simple, clear, and the environment can be set up immediately (e.g., inspecting a file, executing a standard unit test). If you need to check out the branch or clone the PR repo to reproduce the issue, do it in a temporary clone or git worktree (e.g. in `<appDataDir>/brain/<conversation-id>/scratch/issue_12345_repro/`). This keeps the main working repository clean of temporary test files or build side effects.
  - **Static Analysis**: For complex bugs, analyze the logs, stack traces, and relevant specification files (e.g., JSON schemas in `specification/`) to diagnose the issue, but don't spend a bunch of resources setting up a complex reproduction.
- **Action**:
  - If reproduction steps or logs are missing and prevent diagnosis, set action to `needs_info`, draft a response asking for the missing details, and apply the `status: waiting-for-author-response` label.
  - If the bug is verified, suggest the appropriate priority (`P0` to `P3`) and recommend the owner of the affected component based on path mapping (e.g. paths with `renderers/lit` belong to the Lit renderer maintainer, `specification/` to the specification maintainer) and file commit history (`git log -n 5 --format="%ae" <file>`). Do not rely only on raw `git blame`, as formatting or linter changes can skew authorship.
  - Clean up any temporary files, worktrees, clones, and/or temporary branches when finished.

### 2. Feature Requests

- **Analysis**:
  - Verify if the request aligns with the [A2UI roadmap](../../../../docs/public/roadmap.md) and/or design philosophy for the affected components. Be lenient if the idea can be implemented entirely as a client-side catalog extension or a custom renderer component without modifying the core protocol schemas or SDK interfaces.
  - Note if the request seems to be related to a specific issue or PR that has already been discussed.
- **Action**:
  - If aligned, set action to `backlog` with priority `P2` or `P3` and suggest appropriate component labels (e.g., `component: standard catalog specification`, `type: feature/enhancement`).
  - If out of scope, set priority to `P4` and action to `backlog` (keeping the issue open). Draft the standard response explaining that it falls outside the roadmap scope and that PRs against it will not be reviewed.

### 3. Support Requests and Questions

- **Analysis**:
  - Identify if the issue is a question about usage or setup rather than a bug.
  - If the question is answered in the documentation (e.g., [quickstart.md](../../../../docs/public/quickstart.md)), provide a link to the relevant guide in the response.
- **Action**:
  - Set action to `close_resolved` or `close_invalid`.
  - Answer the question directly or provide links to the relevant guides (e.g., [quickstart.md](../../../../docs/public/quickstart.md)) or GitHub Discussions, then close the issue.

---

## Canonical Response Guidelines & Templates

Always keep responses extremely succinct, direct, and professional. Avoid long-winded greetings, excessive preambles, and conversational filler.

- **Be direct**: State the action being taken or what is needed immediately.
- **Eliminate fluff**: Do not use friendly conversational filler like "I hope this helps" or "Have a great day."
- **Actionable**: Ensure the next steps (e.g., what details to provide) are clear.

Canonical Examples (from `docs/contributing/triage-templates.md`):

### Requesting Information

> To help us diagnose this, please provide:
>
> 1. [Specific missing detail, e.g., browser console logs / the exact protocol payload]
> 2. [Simplified reproduction steps or a minimal schema sample]
>
> Marked as `status: waiting-for-author-response` for now.

### Weekly A2UI Compliance Report

> As agreed, this has been assigned a P3 priority. Once the current triage queue is cleared, we will begin reviewing AI-generated issues.

### Assigned Issue Without a Priority

> I assigned a P2 priority to move this out of the triage queue. Please adjust the priority if needed to better reflect the issue's status.

### Stale P2 Issue

> This issue should be considered for a P1 priority together with other P2 issues in the next planning cycle after we burn through the triage queue.

### Stale Assigned P1 Issue

> Ping from triage process: is this issue still on your radar?

### Duplicate Issues

> This is a duplicate of #[Insert Canonical Issue ID], which covers the same root cause.
>
> Closing this to consolidate tracking. Please follow the main issue for updates.

### Out of Scope / Roadmap Conflict

> Thanks for the suggestion. This falls outside the current scope of the A2UI protocol roadmap.
>
> Marked as `P4`: we do not plan to invest in it, and PRs against it will not be reviewed. Leaving it open as a record of the request — comment here if you have new arguments to share.
