# Triage for PRs and issues

## Goals

Continuously make sure that on [a2ui](https://github.com/a2ui-project/a2ui):

1. External PRs are addressed
2. Issues are prioritized and addressed

## References

- [How the automated triage bot works](automation.md)
- [Standard triage replies for issues](templates-issues.md)
- [Decisions made for this triage process](decisions.md)

## Principles

This section describes triage principles at a high level. See concrete steps in the section [Triage process](#triage-process).

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

Fully automated:
- [status: needs-triage][needs-triage-label] -  fully automated

Partially automated:
- [status: waiting-for-author-response][waiting-for-author-response] - removed after out-of-team comment

Manually assigned:
1. Priority labels: [P0][p0], [P1][p1], [P2][p2], [P3][p3], [P4][p4]
2. [status: needs-team-input][needs-team-input]
3. [status: first-line-handled][first-line-handled]
4. [size: small][size-small]
5. [type: contributions-welcome][contributions-welcome]
6. [status: assigned-for-triage][assigned-for-triage]

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

## Queues used in triage

- [Not first line handled][not-first-line-handled]
- [Needs triage][needs-triage-all]
- [Needs triage minus waiting for team input][needs-triage-minus-waiting]

[not-first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20first-line-handled%22%20sort%3Acreated-asc
[needs-triage-all]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-triage%22
[needs-triage-minus-waiting]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-triage%22+-label%3A%22status%3A+needs-team-input%22

## Triage process

### First line triage (daily, by gardener)

For each issue that is [not first-line-handled][not-first-line-handled]:

- If it is P0, add label `P0` and notify team chat
- Add label `status: first-line-handled`

### Second line triage (weekly)

Triage the new items with two steps:

1. Offline - burn [Needs triage minus waiting for team input][needs-triage-minus-waiting]:

    - Triage as described below, if it takes less than 1-2 minutes
    - Otherwize assign [status: needs-team-input][needs-team-input], plus (optionally) add a comment

2. On a triage team meeting - burn [status: needs-team-input][needs-team-input]:

    - Triage as described below, if it takes less than 1-2 minutes
    - Otherwize assign to an axpert in the area and add label [status: assigned-for-triage][assigned-for-triage]

### For owners of `status: assigned-for-triage`

If you are assigned to a PR or an issue with the label `status: assigned-for-triage`, you are treated as an expert in its area, and your job is to triage the item within two weeks of the assignment, using the steps below.

## Triage an item

### Use helpful labels

1. Add [status: waiting-for-author-response][waiting-for-author-response] when a PR or an issue needs a response or clarification from its author or another contributor. The bot removes the label once someone outside the team replies, and the item goes back to the triage queue.

2. Add [size: small][size-small] to highlight a small issue.

3. Add [type: contributions-welcome][contributions-welcome] for rare cases when an issue is specifically designed for external contributions.

### Triage a PR

Decide whether the PR should be reviewed, based on the [principles](#principles) (you do not have to prove your decision is right, just use your intuition).

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

What may help:

- If there is no issue for this change yet, open one that describes the problem, and mention this PR as a possible solution.
- If there is an issue, ask if your contribution on it will be accepted. If you get a positive response, reopen this PR.
- Split a large change into small PRs that are each valuable on their own.
- Before you start, check open issues and PRs for related work, so that your change does not overlap with them.
```

### Triage an issue

1. If the issue is a duplicate, close it with a link to the original issue.
2. Set a priority label, `P0` to `P4`, based on the [principles](#principles). A `P0` or `P1` issue needs an assignee.
4. Answer any open questions or comments from external contributors.
5. For standard cases, such as an out-of-scope request, use the [standard replies for issues](templates-issues.md).

The triage is done when the issue has a priority and no external comment is left unanswered.

### Automation

TODO(polina-c): create automation for the triage process.
