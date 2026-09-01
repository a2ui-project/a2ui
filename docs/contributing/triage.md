# Triage for PRs and issues

See go/a2ui-triage-internal for internal information.

## Goals

Continuously make sure that on [a2ui](https://github.com/a2ui-project/a2ui):

1. External PRs are addressed
2. Issues are prioritized and addressed
3. Number of branches is observable

## Invariant we want to keep

This section describes goals at a high level. See concrete steps in the section [Triage responsibilities](#triage-responsibilities).

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

The relevant issue should be linked in the the PR description.

3. **Branches**: [list of stale branches](https://github.com/a2ui-project/a2ui/branches/stale) should fit on one screen and should not have a button ‘Next’.

## GitHub labels used in triage

1. Priority labels: [P0][p0], [P1][p1], [P2][p2], [P3][p3], [P4][p4]
2. [status: in-discussion][in-discussion]
3. [status: needs-triage][needs-triage-label]
4. [status: first-line-handled][first-line-handled]
5. [size: small][size-small]
6. [type: contributions-welcome][contributions-welcome]
7. [status: waiting-for-author-response][waiting-for-author-response]

See [all github labels](https://github.com/a2ui-project/a2ui/labels).

[p0]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP0
[p1]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP1
[p2]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP2
[p3]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP3
[p4]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP4
[in-discussion]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20in-discussion%22
[needs-triage-label]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-triage%22
[first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20first-line-handled%22
[size-small]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22size%3A%20small%22
[contributions-welcome]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22type%3A%20contributions-welcome%22
[waiting-for-author-response]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20waiting-for-author-response%22

Two of these labels are automated: `status: needs-triage` is managed entirely by the bot, and `status: waiting-for-author-response` is applied manually and automatically cleared once the author replies.

### How the automated triage bot works

The [triage.mjs](../../scripts/triage.mjs) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It reconciles `status: needs-triage` across all open items according to the following rules:

1. **Items waiting on author**: If an item has `status: waiting-for-author-response`, it is skipped. The automation removes this label once the author posts a comment or review submitted after the label was added.
2. **Issues**: Flagged with `status: needs-triage` if any of the following apply:
    - **No priority**: The issue lacks a priority label (`P0`–`P4`).
    - **Unassigned high priority**: Labeled `P0` or `P1` without an assignee.
    - **Stale**: Inactive beyond the priority threshold:
        - `P0`: stale for > 1 day
        - `P1`: stale for > 30 days
        - `P2`: stale for > 90 days
        - (`P3` and `P4` issues are never flagged for staleness)
    - **Unanswered external comment**: The latest human comment is from an external contributor and has been unanswered by a maintainer for > 1 day.
3. **Pull Requests**: Flagged with `status: needs-triage` if opened by an external contributor and no maintainer has responded to the author's latest contribution for > 1 day. (Maintainer-authored PRs are not flagged).

Staleness is calculated from the last human contribution (comment, review, or issue/PR creation) rather than `updated_at` to avoid bot edits resetting the timer.

The workflow runs daily on a schedule (15:00 UTC / 07:00 PST), on manual dispatch, and automatically on issue events (opened, edited, labeled, unlabeled, assigned, unassigned, reopened), new issue comments, and submitted PR reviews or review comments.

## Triage responsibilities

### First line triage (daily)

For each issue that is [not first-line-handled](https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20first-line-handled%22%20sort%3Acreated-asc):

- If it is P0, add label `P0` and notify team chat
- Add label `status: first-line-handled`

### Second line triage (weekly)

Update [items with label `status: needs-triage`][needs-triage], so that the label, managed by [the triage bot](#how-the-automated-triage-bot-works), disappears. Do at least one of the following:

- Set priority (P0-P4)
    - Be sure to assign P0/P1 issues to someone.
- Answer external comments
- Add `status: waiting-for-author-response` when you need more information from the author

You can remove the `needs-triage` label manually to speed up the process, but if the item still matches a rule, the label will come back because the label will be re-applied by the triage bot.

For items where you need input from the team, follow this process (passing any remaining follow-up to the next gardener if still in progress):

1. add the `status: in-discussion` label
2. post a message to the team chat, suggesting options and/or asking for input
3. drive the discussion to resolution
4. remove the label `status: in-discussion`

Use [standard replies](triage-templates.md) that are provided for standard cases.

Lastly, check for [issues which are still unlabeled/unprioritized][unlabeled] (without P0-P4 label and _haven't_ had `status: needs-triage`, `status: in-discussion` or `status: waiting-for-author-response` added to them). If you find such issues, follow the `status: needs-triage` workflow above (This is just to check for issues which somehow fall through the cracks).

When weekly triage is complete, the [`needs-triage`][needs-triage] list should ideally be empty.

[needs-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20sort%3Aupdated-asc%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20in-discussion%22%20-label%3A%22status%3A%20waiting-for-author-response%22
[unlabeled]: https://github.com/a2ui-project/a2ui/issues?q=sort%3Aupdated-desc%20is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20in-discussion%22%20-label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20waiting-for-author-response%22

## AI assistance

Use [.agents/skills/a2ui-issue-triage](../../.agents/skills/a2ui-issue-triage/SKILL.md) to get agent help with triage.

It forks multiple subagents (one for each issue) to try and reproduce the issue if it is something that can be easily reproduced. It won't attempt to repro something that takes a lot of setup.

It will then display a web UI in a local browser with the list of issues to triage, suggested responses (which you can edit) and a UI to apply suggestions to GitHub.

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
