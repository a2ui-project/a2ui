# Triage for PRs and issues

## Goals

Continuously make sure that on [a2ui](https://github.com/a2ui-project/a2ui):

1. External PRs are addressed
2. Issues are prioritized and addressed

## Invariant we want to keep

This section describes goals at a high level. See concrete steps in the section [Triage responsibilities](#triage-responsibilities).

1. **Issues** priority (aligned with other teams in Dash):

    - **P0**: very urgent, and it should be assigned
    - **P1**: actively being worked on, and it should be assigned
    - **P2**: is expected to be converted to P1 within three months, as part of regular planning process
    - **P3**: not planned, but may become a priority
    - **P4**: we do not plan to invest in this issue

2. **PRs**: We review contributions if:

    - they are easy to review
    - they align well with the rest of the work, without stepping on each other's toes
    - we have cycles to review, land, and maintain them over time

## GitHub labels used in triage

1. Priority labels: [P0][p0], [P1][p1], [P2][p2], [P3][p3], [P4][p4]
2. [status: needs-team-input][needs-team-input]
3. [status: needs-triage][needs-triage-label]
4. [status: first-line-handled][first-line-handled]
5. [size: small][size-small]
6. [type: contributions-welcome][contributions-welcome]
7. [status: waiting-for-author-response][waiting-for-author-response]
8. [status: assigned-for-triage][assigned-for-triage]

See [all github labels](https://github.com/a2ui-project/a2ui/labels).

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

### How the automated triage bot works

The [triage.mjs](../../scripts/triage.mjs) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open issue and PR, adds `status: needs-triage` to the ones that match the conditions below, and removes the label from the rest.

The script uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

1. Does the item have `status: waiting-for-author-response`? The bot removes this label once an external contributor responds.

    - If yes: **NO LABEL**.
    - If no: continue processing.

2. Does the item have `status: assigned-for-triage`?

    - If yes:
        - **LABEL** when it has no assignee or got the label more than 14 days ago.
        - **NO LABEL** otherwise.
    - If no: continue processing.

3. Is the item **an issue**?

    - If yes, is it assigned?
        - If assigned:
            - **LABEL** when one of the following is true:
                - It is `P0` with no human activity for more than 1 day, or `P1` with no human activity for more than 30 days.
                - It has no priority label (`P0`–`P4`), and it was opened or commented by an external contributor.
            - **NO LABEL** otherwise.
        - If not assigned:
            - **LABEL** when one of the following is true:
                - It is `P0` or `P1`, which must have an assignee.
                - It has no priority label (`P0`–`P4`) and was opened or commented by an external contributor.
                - The latest human contribution is from an external contributor.
            - **NO LABEL** otherwise.
    - If no: continue processing.

4. Is the item **a PR**?

    - If yes:
        - **LABEL** when it was opened by an external contributor and the latest human contribution is from an external contributor, meaning no team member has responded yet.
        - **NO LABEL** otherwise.

Staleness is calculated from the last human contribution (comment, review, or issue/PR creation) rather than `updated_at` to avoid bot edits resetting the timer.

The bot prints to the console which items it flags or unflags and why. You can use this to track triage progress.

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
- Assign the item to a team member who will finish the triage, and add `status: assigned-for-triage`. The assignee removes the label when done. If the label is still there after 14 days, the bot flags the item again.

You can remove the `needs-triage` label manually to speed up the process, but if the item still matches a rule, the label will come back because the label will be re-applied by the triage bot.

For items where you need input from the team, follow this process (passing any remaining follow-up to the next gardener if still in progress):

1. add the `status: needs-team-input` label
2. post a message to the team chat, suggesting options and/or asking for input
3. drive the discussion to resolution
4. remove the label `status: needs-team-input`

Use [standard replies](triage-templates.md) that are provided for standard cases.

Lastly, check for [issues which are still unlabeled/unprioritized][unlabeled] (without P0-P4 label and _haven't_ had `status: needs-triage`, `status: needs-team-input` or `status: waiting-for-author-response` added to them). If you find such issues, follow the `status: needs-triage` workflow above (This is just to check for issues which somehow fall through the cracks).

When weekly triage is complete, the [`needs-triage`][needs-triage] list should ideally be empty.

[needs-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20sort%3Aupdated-asc%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20needs-team-input%22%20-label%3A%22status%3A%20waiting-for-author-response%22
[unlabeled]: https://github.com/a2ui-project/a2ui/issues?q=sort%3Aupdated-desc%20is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20needs-team-input%22%20-label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20waiting-for-author-response%22

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
