# How A2UI triage works

This document explains the goals, invariants, label definitions, and automation behind the A2UI triage process. For step-by-step instructions on performing daily and weekly triage, see [docs/contributing/triage.md](../contributing/triage.md).

See go/a2ui-triage-internal for Google-internal information.

## Goals

Continuously make sure that on [a2ui](https://github.com/a2ui-project/a2ui):

1. External PRs are addressed
2. Issues are prioritized and addressed
3. Number of branches is observable

## Invariants

1. **Issues** priority (aligned with other teams in Dash):
    - **P0**: very urgent, and it should be assigned
    - **P1**: actively being worked on, and it should be assigned
    - **P2**: is expected to be converted to P1 within three months, as part of regular planning process
    - **P3**: not planned, but may become a priority
    - **P4**: we do not plan to invest in this issue

2. **PRs**: We will review PRs from external contributors if at least one of the following is true:
    - the PR contributes to a **P0-P3** issue (PRs for P4 issues will not be reviewed)
    - the issue is assigned to a contributor by the A2UI team (as assignee or in the first line of issue description) or has label `type: contributions-welcome`
    - the change is, in the opinion of the A2UI team, absolutely clear and obviously needed

The relevant issue should be linked in the PR description.

## GitHub labels used in triage

1. Priority labels: [P0][p0], [P1][p1], [P2][p2], [P3][p3], [P4][p4]
2. [status: needs-team-input][needs-team-input]
3. [status: needs-triage][needs-triage-label]
4. [status: first-line-handled][first-line-handled]
5. [size: small][size-small]
6. [type: contributions-welcome][contributions-welcome]
7. [status: waiting-for-author-response][waiting-for-author-response]
8. [status: assigned-for-triage][assigned-for-triage]

See [all GitHub labels](https://github.com/a2ui-project/a2ui/labels).

[p0]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP0
[p1]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP1
[p2]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP2
[p3]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP3
[p4]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP4
[needs-team-input]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-team-input%22
[needs-triage-label]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-triage%22
[first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20first-line-handled%22
[size-small]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22size%3A%20small%22
[contributions-welcome]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22type%3A%20contributions-welcome%22
[waiting-for-author-response]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20waiting-for-author-response%22
[assigned-for-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20assigned-for-triage%22

Two of these labels are automated: `status: needs-triage` is managed entirely by the bot, and `status: waiting-for-author-response` is applied manually and automatically cleared once the author replies. The bot also reads `status: assigned-for-triage`, which is applied and removed manually, and flags items that carry it without an assignee or for more than 14 days.

## How the automated triage bot works

The [triage.mjs](../../scripts/triage.mjs) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open item against the rules below, in order. An item that matches a rule is flagged: it gets `status: needs-triage`. Otherwise the label is removed.

1. **Triage assignments**: An issue or PR with `status: assigned-for-triage` is flagged if it has no assignee, or if the label was added more than 14 days ago. Otherwise it is not flagged, because the assignee is triaging it. The 14 days count from the most recent time the label was added, so removing and re-adding the label restarts them. The rules below do not apply to these items.
2. **Waiting on author**: An item with `status: waiting-for-author-response` is not flagged. The bot removes this label once an external contributor posts a comment, review, or review comment after the label was added.
3. **Assigned issues**: Flagged only if a P0 or P1 issue is stale, meaning it has had no human activity for:
    - `P0`: more than 1 day
    - `P1`: more than 30 days
4. **Unassigned issues**: Flagged if any of the following apply:
    - **No priority**: The issue has no priority label (`P0`–`P4`).
    - **High priority**: The issue is `P0` or `P1`, which must have an assignee.
    - **Unanswered external comment**: The latest human comment is from an external contributor.
5. **Pull requests**: Flagged if opened by an external contributor and no maintainer has responded to the author's latest contribution. Maintainer-authored PRs are not flagged.
6. **Transparency**: The automation prints to the console what items are flagged or unflagged and why. This can be used to track triage progress.

Staleness is calculated from the last human contribution (comment, review, or issue/PR creation) rather than `updated_at` to avoid bot edits resetting the timer.

The workflow runs daily on a schedule (15:00 UTC / 07:00 PST), on manual dispatch, and automatically on issue events (opened, edited, labeled, unlabeled, assigned, unassigned, reopened), new issue comments, and submitted PR reviews or review comments.

## AI assistance

Use [.agents/skills/a2ui-issue-triage](../../.agents/skills/a2ui-issue-triage/SKILL.md) to get agent help with triage.

It forks multiple subagents (one for each issue) to try and reproduce the issue if it is something that can be easily reproduced. It won't attempt to repro something that takes a lot of setup.

It will then display a web UI in a local browser with the list of issues to triage, suggested responses (which you can edit), and a UI to apply suggestions to GitHub.

## Frequently asked questions

### Why do we allow branches on the repo and thus create work for maintainers?

Eval and e2e tests cannot be executed on pre-submit for PRs from forks, because they require an API key that is visible only on the original repo.

We want evals and e2e's to run on pre-submit at least for team members.

Watching branches is not big extra toil for triage process, because:

1. If we forbid branches, the work will not disappear, it will just move to the fork
2. It is easy to cleanup branches because ownership is clear
3. As team members know it is part of triage to clean them up, they are more careful managing their branches

### Why do we need P4? Why not just close the issue?

We need the label P4, because:

1. Just closing the issue will not give a clear searchable sign why it is closed
2. External developers can reopen issue, but cannot change label

It is better not to close P4, because:

1. As we have label P4 anyway, closing the issue is an extra step.
2. If P4 is open, it is a sign that this feature request is still:
    1. not implemented
    2. seems to be valuable
    3. considered P4

    which adds clarity and makes it harder to push for prioritization.
