# Triage instructions

For background on triage goals, label definitions, and how the triage bot works, see [docs/internal/triage_explainer.md](../internal/triage_explainer.md). For Google-internal information, see go/a2ui-triage-internal.

## First-line triage (daily)

Open the list of issues that are [not first-line-handled][not-first-line-handled] and do the following for each issue:

- If the issue is urgent (`P0`), add the [`P0`][p0] label, assign an owner, and notify the team chat.
- Add the [`status: first-line-handled`][first-line-handled] label.

## Second-line triage (weekly)

Process all open items in the [`status: needs-triage`][needs-triage] queue until the list is empty:

- Use the [AI triage skill](../../.agents/skills/a2ui-issue-triage/SKILL.md) to help analyze issues, reproduce simple bugs, and draft replies in a local browser UI, or triage items directly on GitHub.
- Use the [standard replies](triage-templates.md) for common issue and pull request cases.
- Assign a priority label to each unprioritized issue:
    - [`P0`][p0]: very urgent (must also be assigned and announced in team chat).
    - [`P1`][p1]: actively being worked on (must also be assigned).
    - [`P2`][p2]: expected to convert to `P1` within three months during regular planning.
    - [`P3`][p3]: not planned right now, but may become a priority later.
    - [`P4`][p4]: no plan to invest in this issue (leave the issue open; do not close it).
- Assign an owner to any `P0` or `P1` issue that lacks an assignee.
- Reply to unanswered comments from external contributors on issues and pull requests.
- Follow up on stale assigned issues (`P0` inactive for > 1 day, `P1` for > 30 days) using the [stale issue replies](triage-templates.md).
- Add the [`status: waiting-for-author-response`][waiting-for-author-response] label when you ask an author for more information or conflict resolution.
- Assign an item to a team member who will finish triaging it, and add the [`status: assigned-for-triage`][assigned-for-triage] label (the assignee removes the label when done; if the label remains after 14 days, the bot flags the item again).
- Triage external pull requests in the queue:
    - Review or route the PR if the change is obviously needed, or if it links to a `P0`–`P3` issue in its description that is either assigned to the author or labeled [`type: contributions-welcome`][contributions-welcome].
    - Close the PR using the matching [PR template](triage-templates.md#pull-requests) if it targets a `P4` issue, lacks a linked issue for a complex change, targets an issue not assigned to the author, or is outside project scope.
- Escalate items that require team input (and hand off any unfinished discussions to the next triager):
    1. Add the [`status: needs-team-input`][needs-team-input] label.
    2. Post a message in the team chat with suggested options or questions.
    3. Drive the discussion to resolution and apply the decision.
    4. Remove the `status: needs-team-input` label.
- Optionally remove the `status: needs-triage` label manually as you finish each item (the triage bot also removes it automatically once the underlying condition is resolved, and will re-apply it if an item still matches a rule).
- Check for [unlabeled and unprioritized issues][unlabeled] that may have fallen through the cracks (missing `P0`–`P4` and missing `status: needs-triage`, `status: needs-team-input`, and `status: waiting-for-author-response`), and triage any that appear.

[not-first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20first-line-handled%22%20sort%3Acreated-asc
[needs-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20sort%3Aupdated-asc%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20needs-team-input%22%20-label%3A%22status%3A%20waiting-for-author-response%22
[unlabeled]: https://github.com/a2ui-project/a2ui/issues?q=sort%3Aupdated-desc%20is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3AP4%20-label%3A%22status%3A%20needs-team-input%22%20-label%3A%22status%3A%20needs-triage%22%20-label%3A%22status%3A%20waiting-for-author-response%22
[p0]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP0
[p1]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP1
[p2]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP2
[p3]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP3
[p4]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3AP4
[needs-team-input]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20needs-team-input%22
[first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20first-line-handled%22
[contributions-welcome]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22type%3A%20contributions-welcome%22
[waiting-for-author-response]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20waiting-for-author-response%22
[assigned-for-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22status%3A%20assigned-for-triage%22
