# Triage for PRs and issues

## Goals

Continuously make sure that on [a2ui](https://github.com/a2ui-project/a2ui):

1. External PRs are addressed
2. Issues are prioritized and addressed

## References

- [How the automated triage bot works](automation.md)
- [Standard triage replies for issues](templates-issues.md)
- [Standard triage replies for PRs](templates-prs.md)
- [Decisions made for triage process](decisions.md)

## Principles

This section describes triage principles at a high level. See concrete steps in the section [Triage responsibilities](#triage-responsibilities).

1. **Issues** priority (aligned with other teams in Dash):

    - **P0**: very urgent, and it should be assigned
    - **P1**: actively being worked on, and it should be assigned
    - **P2**: is expected to be converted to P1 within three months, as part of regular planning process
    - **P3**: not planned, but may become a priority
    - **P4**: we do not plan to invest in this issue

2. **PRs**: We review a PR when all of the following are true:

    - It is a minor change (such as a docs fix or a small bug fix with a test), or it addresses an issue that is assigned to the PR author.
    - It does not overlap with work already in progress.
    - It brings a change that the team can maintain long term.

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

## Triage responsibilities

### First line triage (daily)

For each issue that is [not first-line-handled](https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20first-line-handled%22%20sort%3Acreated-asc):

- If it is P0, add label `P0` and notify team chat
- Add label `status: first-line-handled`

### Second line triage (weekly)
Update [items with label `status: needs-triage`][needs-triage], so that the label, managed by [the triage bot](automation.md), disappears:

- Set priority (P0-P4) to issues. Assign P0/P1 to someone.
- Answer external comments.
- Add `status: waiting-for-author-response` when you need more information from the author
- Assign the item to a team member who will finish the triage, and add `status: assigned-for-triage`.

You can remove the `needs-triage` label manually to speed up the process, but if the item still matches a rule, the label will come back because the label will be re-applied by the triage bot.

For items where you need input from the team, follow this process (passing any remaining follow-up to the next gardener if still in progress):

1. add the `status: needs-team-input` label
2. post a message to the team chat, suggesting options and/or asking for input
3. drive the discussion to resolution
4. remove the label `status: needs-team-input`

Use the standard replies provided for [issues](templates-issues.md) and [PRs](templates-prs.md) in standard cases.

Lastly, check for [issues which are still unlabeled/unprioritized][unlabeled] (without P0-P4 label and _haven't_ had `status: needs-triage`, `status: needs-team-input` or `status: waiting-for-author-response` added to them). If you find such issues, follow the `status: needs-triage` workflow above (This is just to check for issues which somehow fall through the cracks).

When weekly triage is complete, the [`needs-triage`][needs-triage] list should ideally be empty.

[needs-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20sort%3Aupdated-asc%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20needs-team-input%22%20-label%3A%22status%3A%20waiting-for-author-response%22
[unlabeled]: https://github.com/a2ui-project/a2ui/issues?q=sort%3Aupdated-desc%20is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20needs-team-input%22%20-label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20waiting-for-author-response%22

### Owners of `status: assigned-for-triage`

If you are assigned to a PR or an issue with the label `status: assigned-for-triage`, you are treated as an expert in its area, and your job is to triage the item within two weeks of the assignment, using the steps below.

### Use lyfecycle labels

Assign `status: waiting-for-author-response`, when PR or issue needs aouthor's or other contributor's respons eor clarification.

### Triage a PR

Decide whether the PR should be reviewed, based on the [principles](#principles) (you do not have to prove your decision is right - it is ok to use intuition).

If yes, review it and help to land it. Do not hesitate to create a superseding PR if it is more efficient.

If no:

1. Close the PR.
2. Post the comment (you may want to add it to your [GitHub saved replies](https://docs.github.com/en/get-started/writing-on-github/working-with-saved-replies)):

```txt
Thank you for taking the time to contribute to A2UI. We appreciate it. Unfortunately, we must decline this PR at this time.

Our team is small, so we can't review every PR. We review a PR when:

- it is a minor change (such as a docs fix or a small bug fix with a test), or it addresses an issue that is assigned to you,
- it doesn't overlap with work already in progress, and
- it brings a change that we can maintain long term.

What may help, but without guarantees:

- If there is no issue for this change yet, open one that describes the problem, and mention this PR as a possible solution.
- If there is an issue, ask if your contribution on it will be accepted. If you get positive response, reopen this PR.
- Split a large change into small PRs valuable independently.
- Before you start, check open issues and PRs for related work, so that your change does not overlap with them.
```

### Triage an issue


