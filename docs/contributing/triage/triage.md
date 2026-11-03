# Triage for PRs and issues

## Goals

Continuously make sure that on [a2ui](https://github.com/a2ui-project/a2ui):

1. Every external PR gets a decision: the team reviews it, or closes it with an explanation.
2. Every issue has a priority, and every `P0` and `P1` issue has an assignee who is making progress on it.
3. Every question or comment from outside the team gets an answer.

## References

- [How the automated triage bot works](../../../blueprints/devtools/triage_flagging.blueprint.md)
- [Standard triage replies for issues](templates.md)
- [Decisions made for this triage process](decisions.md)

## Principles

This section describes triage principles at a high level. See concrete steps in the section [Triage process](#triage-process).

1. **Issues** priority (aligned with other teams in Dash):

    - **P0**: very urgent, and it should be assigned
    - **P1**: actively being worked on, and it should be assigned
    - **P2**: expected to become P1 within three months, as part of the regular planning process
    - **P3**: not planned, but may become a priority
    - **P4**: we do not plan to invest in this issue

2. **PRs**: We review a PR when all of the following are true:

    - It is a minor change (such as a docs fix or a small bug fix with a test), or it addresses an issue that is assigned to the PR author.
    - It does not overlap with work already in progress.
    - It brings a change that the team can maintain long term.

## GitHub labels used in triage

Added and removed by the [triage bot](../../../blueprints/devtools/triage_flagging.blueprint.md):

- [status: needs-triage][needs-triage-label]: the item needs triage.

Added manually, removed by the bot:

- [status: waiting-for-author-response][waiting-for-author-response]: the team is waiting for a reply from the author or another contributor. The bot removes the label once someone outside the team replies.

Added and removed manually:

- Priority labels [P0][p0], [P1][p1], [P2][p2], [P3][p3], [P4][p4]: see [Principles](#principles).
- [status: first-line-handled][first-line-handled]: the issue went through first line triage.
- [status: needs-team-input][needs-team-input]: the item is discussed at the weekly triage meeting.
- [status: assigned-for-triage][assigned-for-triage]: an expert in the area finishes the triage. The bot flags the item again if nobody is assigned or the label stays for more than 14 days.
- [size: small][size-small]: the issue is small.
- [type: contributions-welcome][contributions-welcome]: the issue is meant for external contributors.

See [all GitHub labels](https://github.com/a2ui-project/a2ui/labels).

[p0]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP0
[p1]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP1
[p2]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP2
[p3]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP3
[p4]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP4
[needs-team-input]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-team-input%22
[needs-triage-label]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-triage%22
[first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20first-line-handled%22
[size-small]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22size%3A%20small%22
[contributions-welcome]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22type%3A%20contributions-welcome%22
[waiting-for-author-response]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20waiting-for-author-response%22
[assigned-for-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20assigned-for-triage%22
[team-chat]: https://chat.google.com/room/AAQAvhq57Zo

## Queues used in triage

- [Not first line handled][not-first-line-handled]: new issues for [first line triage](#first-line-triage-daily-by-gardener).
- [Needs triage][needs-triage-all]: everything the bot flagged.
- [Needs triage, without team input][needs-triage-minus-waiting]: the flagged items to go through before the weekly meeting.

[not-first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20first-line-handled%22%20sort%3Acreated-asc
[needs-triage-all]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-triage%22
[needs-triage-minus-waiting]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-triage%22+-label%3A%22status%3A+needs-team-input%22

## Triage process

### First line triage (daily, by gardener)

For each issue that is [not first-line-handled][not-first-line-handled]:

- If it is P0, add the label `P0` and notify [the team chat][team-chat].
- Add the label `status: first-line-handled`.

### Second line triage (weekly, by triager)

1. Before the triage meeting, on your own:

    - In go/a2ui-triage-log, copy the triage card template and start filling it in.

    - Burn [Needs triage, without team input][needs-triage-minus-waiting]. For each item:
        - If you can triage it in a couple of minutes, [triage it](#triage-an-item).
        - Otherwise, add [status: needs-team-input][needs-team-input]. Optionally, add a comment with your thoughts.

2. At the triage meeting, burn [status: needs-team-input][needs-team-input]. For each item:

    - If the team can triage it in a couple of minutes, [triage it](#triage-an-item) and remove `status: needs-team-input`.
    - Otherwise, assign it to an expert in the area, add [status: assigned-for-triage][assigned-for-triage], and remove `status: needs-team-input`.

3. Complete the triage card in go/a2ui-triage-log and send it to [the team chat][team-chat].

### By owners of `status: assigned-for-triage`

If you are assigned to a PR or an issue with the label `status: assigned-for-triage`, you are treated as an expert in its area, and your job is to [triage the item](#triage-an-item) within two weeks of the assignment. Then remove the label.

## Triage an item

### Add labels that help

- Add [status: waiting-for-author-response][waiting-for-author-response] when a PR or an issue needs a response or clarification from its author or another contributor. The bot removes the label once someone outside the team replies, and the item goes back to the triage queue.
- Add [size: small][size-small] to a small issue.
- Add [type: contributions-welcome][contributions-welcome] in the rare case when an issue is meant for external contributors.

### Triage a PR

Decide whether the PR should be reviewed, based on the [principles](#principles). You do not have to prove your decision is right; use your intuition.

If yes, review it and help land it. If it is faster, create a superseding PR instead.

If no, post the reply below and close the PR. The **Close with comment** button does both. You may want to add the reply to your [GitHub saved replies](https://docs.github.com/en/get-started/writing-on-github/working-with-saved-replies).

```
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
2. Set a priority label, `P0` to `P4`, based on the [principles](#principles). Assign someone to a `P0` or `P1` issue.
3. Answer any open questions or comments from external contributors.
4. For standard cases, such as an out-of-scope request, use the [standard replies for issues](templates.md).

The triage is done when the issue has a priority and no external comment is left unanswered.

## Automation

TODO(polina-c): create automation for the triage process.
