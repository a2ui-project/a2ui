# Triage criteria for the advisor

This document says how to turn an issue or a PR into a [`TriageSuggestion`](../../../../tools/internal/triage_new/pkgs/triage/lib/src/triage_item/triage_suggestion.dart). It adds advisor rules to the canonical sources; where they disagree, the canonical sources win:

1. [triage.md](../../../../docs/contributing/triage/triage.md): goals of triage, priority definitions (`P0` to `P3`), and how to triage a PR.
2. [labels.md](../../../../docs/contributing/triage/labels.md): triage labels and who manages each one.
3. [templates.md](../../../../docs/contributing/triage/templates.md): standard replies.

Triage of an issue is done when the issue has a priority and no comment from an out-of-team contributor is left unanswered. Triage of a PR is done when the team has decided to review it or has closed it with an explanation. Every suggestion should get the item to that state, or say what is missing.

## Rules for every item

1. If an issue has no priority label, suggest one, or suggest closing the issue with `close_as`.
2. If a `P0` or `P1` issue has no assignee, suggest one.
3. If an out-of-team contributor asked something that no team member answered, draft an answer in `reply`. If you cannot answer it from the docs and code, say in `suggestion` who could.
4. Add `status: first-line-handled` to an issue that does not have it.
5. Suggest a `component: ...` label and a `type: ...` label when the item has none and the area is clear.
6. Suggest removing labels that no longer apply, such as `status: needs-team-input` after the team answered, or `status: assigned-for-triage` once the item has a priority.
7. Never add or remove `status: needs-triage`. The [flagger](../../../../tools/internal/triage/blueprints/flagging.blueprint.md) manages it.
8. If a team member agreed in a comment that a contributor works on the issue, but did not assign them, suggest assigning them in `new_assignees`.
9. If the item cannot be triaged without more expertise, find an expert in the affected area from the commit history (see step 4 of the [skill](../SKILL.md#step-4-research-the-item)), and name them in `suggestion` with the evidence, such as "wrote 6 of the last 20 commits to `renderers/lit`". Then follow the [second-line triage](../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager) steps:
   1. If the item does not have `status: needs-team-input`, suggest adding it, and say which question the team needs to answer.
   2. If it has `status: needs-team-input`, the team could not triage it in a couple of minutes. Suggest assigning the expert in `new_assignees`, adding `status: assigned-for-triage`, and removing `status: needs-team-input`.

   If you find no expert who can be assigned, say so, and suggest only `status: needs-team-input`.

## Issues

### Duplicates

If another issue reports the same problem or asks for the same change, set `close_as` to `duplicate` and `duplicate_of` to its number, draft a `reply` that links to it, and do not suggest a priority. Open the other issue first: matching titles are not enough.

### Bug reports

1. If the report has no reproduction steps or logs, and you cannot diagnose it without them, add `status: waiting-for-author-response` and use the [Requesting information](../../../../docs/contributing/triage/templates.md#requesting-information) template as the `reply`.
2. Otherwise, add `type: bug`, suggest a priority, and say how you diagnosed it: from the logs, the specification, the code, or a reproduction.
3. For `P0` and `P1`, suggest an owner of the affected area as the assignee (see step 4 of the [skill](../SKILL.md#step-4-research-the-item)).

### Feature requests

1. Check the request against the [roadmap](../../../../docs/public/roadmap.md) and the design of the affected area.
2. If it fits, add `type: feature/enhancement` and suggest `P2` or `P3`.
3. If it does not fit, set `close_as` to `not_planned`, use the [Out of Scope](../../../../docs/contributing/triage/templates.md#out-of-scope--roadmap-conflict) template as the `reply`, and do not suggest a priority.

### Questions

If the issue asks how to use or set up A2UI rather than reporting a defect, add `question`, draft an answer in `reply` that links to the relevant guide (such as [quickstart.md](../../../../docs/public/quickstart.md)), and set `close_as` to `completed`.

### Standard cases

For the cases in [templates.md](../../../../docs/contributing/triage/templates.md), suggest what the template says, and use its text as the `reply`. These include an assigned issue without a priority (`P2`) and an AI-generated compliance report (close as not planned).

Do not suggest a ping for a stale assigned issue. The [staleness pinger](../../../../tools/internal/triage_new/blueprints/features/staleness_ping.blueprint.md) does that.

## Pull requests

Follow [Triage a PR](../../../../docs/contributing/triage/triage.md#triage-a-pr). Suggest a review when all of the following are true, and say which ones you checked:

1. The PR is a minor change, such as a docs fix or a small bug fix with a test, or it addresses an issue that is assigned to the PR author.
2. It does not overlap with open PRs or work in progress. List overlapping PRs in `related_prs`.
3. The team can maintain the change long term.

If you suggest a review, suggest assigning an owner of the changed files, and list the issues the PR closes in `related_issues`.

Otherwise, set `close_as` to `not_planned` and use the reply from [Triage a PR](../../../../docs/contributing/triage/triage.md#triage-a-pr) as the `reply`.

If the PR is a draft, or is waiting for its author after a review, suggest `status: waiting-for-author-response` instead of a decision.
