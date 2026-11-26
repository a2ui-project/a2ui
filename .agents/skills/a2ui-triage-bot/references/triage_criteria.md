# Triage criteria for the triage bot

This document says how to turn an issue or a PR into a [`TriageAnalysis`](../../../../tools/internal/triage/pkgs/shared/lib/src/triage_bot/triage_analysis.dart), and what a [response comment](../SKILL.md#response-comment) suggests. It adds triage bot rules to the canonical sources; where they disagree, the canonical sources win:

1. [triage.md](../../../../docs/contributing/triage/triage.md): goals of triage, priority definitions (`P0` to `P3`), and how to triage a PR.
2. [labels.md](../../../../docs/contributing/triage/labels.md): triage labels and who manages each one.
3. [templates.md](../../../../docs/contributing/triage/templates.md): standard replies.

Triage of an issue is done when the issue has a priority and no comment from an out-of-team contributor is left unanswered. Triage of a PR is done when the team has decided to review it, has assigned it to an expert with `status: assigned-for-triage`, or has closed it with an explanation. Every suggestion should get the item to that state, or say what is missing.

## Rules for every item

1. If an issue has no priority label, suggest one, or suggest closing the issue with `close_as`.
2. If a `P0` or `P1` issue has no assignee, suggest one.
3. If an out-of-team contributor asked something that no team member answered, draft an answer in `reply`. If you cannot answer it from the docs and code, say in `suggestion` who could.
4. Add `status: first-line-handled` to an issue that does not have it.
5. Suggest a `component: ...` label and a `type: ...` label when the item has none and the area is clear.
6. Suggest removing labels that no longer apply, such as `status: needs-team-input` after the team answered, or `status: assigned-for-triage` once the item has a priority.
7. Never add or remove `status: needs-triage`. The [flagger](../../../../tools/internal/triage/blueprints/features/flagger.blueprint.md) manages it.
8. If a team member agreed in a comment that a contributor works on the issue, but did not assign them, suggest assigning them in `new_assignees`.
9. If the item cannot be triaged without more expertise, find an expert in the affected area from the commit history (see step 4 of the [skill](../SKILL.md#step-4-research-the-item)), and name them in `suggestion` with the evidence, such as "wrote 6 of the last 20 commits to `renderers/lit`". Then follow the [second-line triage](../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager) steps:
   1. If the item does not have `status: needs-team-input`, suggest adding it, and say which question the team needs to answer.
   2. If it has `status: needs-team-input`, the team is discussing it. Write no analysis, and answer only the requests to the triage bot, in a response comment.

   If you find no expert who can be assigned, say so, and suggest only `status: needs-team-input`.

   This rule does not apply to a PR that is a good candidate for review or that overlaps with other PRs: for those, follow [Pull requests](#pull-requests).

10. When you suggest an assignee for an item that relates to other open issues or PRs, such as a PR and the issue it targets, or PRs that overlap, suggest the same person for all of them. If one of the related items already has an assignee, suggest that person, unless they cannot be assigned; then say so in `suggestion`. Name the related items in `suggestion`, and list them in `targeted_issues`, `targeting_prs` or `related_items`.
11. If a team member asked the triage bot for something, answer it at the start of `suggestion`, or in a response comment on an item with `status: needs-team-input`, as [Requests to the triage bot](../SKILL.md#requests-to-the-triage-bot) says. Follow these rules for what the answer suggests: a request does not override them.

## Issues

### Duplicates

If another issue reports the same problem or asks for the same change, set `close_as` to `duplicate` and `duplicate_of` to its number, draft a `reply` that links to it, and do not suggest a priority. Open the other issue first: matching titles are not enough.

### Bug reports

1. If the report has no reproduction steps or logs, and you cannot diagnose it without them, add `status: waiting-for-author-response` and use the [Requesting information](../../../../docs/contributing/triage/templates.md#requesting-information) template as the `reply`.
2. Otherwise, add `type: bug`, suggest a priority, and say how you diagnosed it: from the logs, the specification, the code, or a reproduction.
3. For `P0` and `P1`, suggest an owner of the affected area as the assignee (see step 4 of the [skill](../SKILL.md#step-4-research-the-item)).

### Feature requests

1. Check the request against the [roadmap](../../../../docs/site/src/content/docs/roadmap.mdx) and the design of the affected area.
2. If it fits, add `type: feature/enhancement` and suggest `P2` or `P3`.
3. If it does not fit, set `close_as` to `not_planned`, use the [Out of Scope](../../../../docs/contributing/triage/templates.md#out-of-scope--roadmap-conflict) template as the `reply`, and do not suggest a priority.

### Questions

If the issue asks how to use or set up A2UI rather than reporting a defect, add `question`, draft an answer in `reply` that links to the relevant guide (such as [quickstart.mdx](../../../../docs/site/src/content/docs/quickstart.mdx)), and set `close_as` to `completed`.

### Standard cases

For the cases in [templates.md](../../../../docs/contributing/triage/templates.md), suggest what the template says, and use its text as the `reply`. These include an assigned issue without a priority (`P2`) and an AI-generated compliance report (close as not planned).

For an assigned issue without a priority, leave out the template's request to adjust the priority, and use only "I assigned a P2 priority to move this out of the triage queue." as the `reply`.

Do not suggest a ping for a stale assigned issue. The [staleness pinger](../../../../tools/internal/triage/blueprints/features/triage_bot/staleness_ping.blueprint.md) does that.

## Pull requests

Follow [Triage a PR](../../../../docs/contributing/triage/triage.md#triage-a-pr), with one change: where it says to review the PR, the triage bot suggests an expert who decides, as the rules below say. Never suggest "review it", and never promise a review.

Until a team member has started reviewing an out-of-team contributor's PR, do not ask its author to resolve merge conflicts, merge `main` or rebase, and do not add `status: waiting-for-author-response` because of conflicts. If the team declines the PR, that work would waste the contributor's time. Mention the conflicts in `suggestion`, for the triager and the expert, and leave them out of `reply`. Once a team member has started reviewing, the reviewer decides when to ask for it.

If Dependabot opened the PR (author `dependabot`, or `dependabot[bot]` in the REST API) and the PR has merge conflicts with `main`, set `close_as` to `not_planned` and skip the rules below. Say in `suggestion` that the PR has conflicts, and list in `related_items` any open Dependabot PR with the same updates. Use this `reply`: "Closing because this PR has merge conflicts with `main`."

If a team member other than the PR author submitted a review, in any state, that team member started reviewing the PR, and the team has decided to review it. Suggest assigning the reviewer, say in the `Case:` line of `tldr` that they started reviewing it, such as "Case: `xyz` already started reviewing this external PR.", link to their review in `suggestion`, say it in `reply`, such as "Assigning this PR to `xyz`, because they already started reviewing it.", and skip the review criteria below. If several team members reviewed, suggest the one whose review came first. If the reviewer is already assigned, suggest no assignee. Bots, such as `gemini-code-assist`, are not team members, so their reviews do not count.

Otherwise, the PR is a good candidate for review when all of the following are true. Say which ones you checked:

1. The PR is a minor change, such as a docs fix or a small bug fix with a test, or it addresses an issue that is assigned to the PR author.
2. It does not overlap with open PRs or work in progress. List overlapping PRs in `related_items`.
3. The team can maintain the change long term.

If the PR is a good candidate, suggest assigning it to an expert in the changed files (see step 4 of the [skill](../SKILL.md#step-4-research-the-item)) and adding `status: assigned-for-triage`. The expert decides whether the team reviews the PR. When the triager applies the label, the triage UI also requests the expert's review, so do not suggest it separately. If the expert is already assigned but has not reviewed the PR, suggest only the label. Name the expert in `suggestion` with the evidence, such as "wrote 9 of the 15 commits to `generic-binder.ts`", and list the issues the PR targets in `targeted_issues`.

If the PR meets the other criteria but overlaps with open PRs or work in progress, do the same: suggest assigning an expert and adding `status: assigned-for-triage`. List the overlapping PRs in `related_items`, and say in `suggestion` what the expert needs to decide, such as which of the PRs to take. Do not suggest `status: needs-team-input` for it.

Do not promise a review in `reply` or anywhere else: write nothing like "we will review it". The team has not decided yet, and the expert may close the PR. Say only who the PR is assigned to and why, such as "Assigning this PR to `xyz`, who maintains `web_core`, to decide on it."

Otherwise, set `close_as` to `not_planned` and use the reply from [Triage a PR](../../../../docs/contributing/triage/triage.md#triage-a-pr) as the `reply`.

If the PR is waiting for its author after a review, suggest `status: waiting-for-author-response` instead of a decision.

If the PR is unfinished and waits for its author, suggest converting it to a draft. Every triage tool ignores draft PRs, so the PR leaves the triage queue until its author marks it ready for review. A PR is unfinished when its title or description says it is a draft or work in progress, such as "first draft" or "WIP", or when it has had no commits for 30 days and has merge conflicts with `main`. Merge conflicts make an out-of-team contributor's PR unfinished only after a team member has started reviewing it, as said above. For example, [#2320](https://github.com/a2ui-project/a2ui/pull/2320), titled "first draft", had no commits for three months and had merge conflicts. `TriageAnalysis` has no property for it, so start `suggestion` with it and give the command that does it: `gh pr ready <number> --undo -R a2ui-project/a2ui`. Say it in `reply` too, such as "Converting this PR to a draft, because it has had no commits since August and has merge conflicts with `main`. Mark it ready for review when it is."
