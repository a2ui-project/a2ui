# Triage overview

This page explains what triage is for and what each triage label means. For the steps to follow, see [Triage for PRs and issues](triage.md).

## Goals

Continuously make sure that:

1. Every PR gets a decision: the team reviews it, or closes it with an explanation.
2. Every issue has a priority, and every `P0` and `P1` issue has an assignee who is making progress on it.
3. Questions and comments get replies from the team.

## GitHub labels used in triage

Added and removed by the triage bot, [scripts/triage.mjs](../../../scripts/triage.mjs):

- [status: needs-triage][needs-triage-label]: the item needs triage. The [needs triage queue][needs-triage-all] lists all of them.

Added manually, removed by the bot:

- [status: waiting-for-author-response][waiting-for-author-response]: the team is waiting for a reply from the author or another contributor. The bot removes the label once someone outside the team replies.

Added and removed manually:

- Priority labels [P0][p0], [P1][p1], [P2][p2], [P3][p3], [P4][p4]: see [Triage an issue](triage.md#triage-an-issue). For why `P4` issues stay open, see [decisions](decisions.md).
- [status: first-line-handled][first-line-handled]: the issue went through first line triage.
- [status: needs-team-input][needs-team-input]: the triager needs input from the team to triage the item.
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
[needs-triage-all]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-triage%22
[first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20first-line-handled%22
[size-small]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22size%3A%20small%22
[contributions-welcome]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22type%3A%20contributions-welcome%22
[waiting-for-author-response]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20waiting-for-author-response%22
[assigned-for-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20assigned-for-triage%22
