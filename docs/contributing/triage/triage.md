# Triage for PRs and issues

The goals of triage are to continuously make sure that:

1. Every PR gets a decision: the team decides to review it, or closes it with an explanation.
2. Every issue has a priority, and every `P0` and `P1` issue has an assignee who is making progress on it.
3. Questions and comments get replies from the team.

Queues used in triage:

- [First-line triage queue][not-first-line-handled]: new issues that need to be checked for criticality, following [these instructions](#first-line-triage-daily-by-gardener).
- [Second-line triage queue][needs-triage-minus-waiting]: issues and PRs that need second-line triage, following [these instructions](#second-line-triage-weekly-by-triager).

See [list of labels used in triage](labels.md).

## First line triage (daily, by gardener)

For each issue in the [first-line triage queue][not-first-line-handled]:

- If the issue is critical and must be fixed urgently (for example, the tree is broken, it is a major security issue, or it is an unplanned breaking change), add the label `P0` and notify the team.
- Add the label `status: first-line-handled`.

## Second line triage (weekly, by triager)

1. Go through the [second-line triage queue][needs-triage-minus-waiting]. For each item:

    - If you can triage it in a couple of minutes, [triage it](#triage-an-item).
    - Otherwise, add [status: needs-team-input][needs-team-input]. Optionally, add a comment with your thoughts, starting with `**From triager for team discussion:**`, so that the [triage UI](../../../tools/internal/triage_new/blueprints/features/ui.blueprint.md) shows it with the item's suggestion. To ask the triage bot a question or for help, address it in that comment, as in "Triage bot, ...?". The [triage bot](../../../tools/internal/triage_new/blueprints/features/triage_bot.blueprint.md#requests-to-the-triage-bot) answers in a comment headed `**Response from triage bot:**` at its next daily run.

2. Go through [status: needs-team-input][needs-team-input] with other team members. For each item:

    - If you can triage it in a couple of minutes, [triage it](#triage-an-item) and remove `status: needs-team-input`.
    - Otherwise, assign it to an expert in the area, add [status: assigned-for-triage][assigned-for-triage], and remove `status: needs-team-input`.

## Triage an item

### Add labels

- Add [status: waiting-for-author-response][waiting-for-author-response] when a PR or an issue needs a response or clarification from its author or another contributor. The bot removes the label once someone outside the team replies, and the item goes back to the triage queue.
- Add [size: small][size-small] to a small issue.

### Triage an issue

1. If the issue is a duplicate, close it with a link to the original issue.
2. Set a priority label:

    - `P0`: urgent issue. Assign someone.
    - `P1`: a priority. The team is actively working on it, or will be soon. Assign someone.
    - `P2`: the team intends to work on it.
    - `P3`: a good request. It is not currently planned, but may become a priority.

    If the team does not plan to invest in the issue, close it as not planned instead.

3. Respond to open questions and comments (see [standard replies](templates.md) for common types of issues).

The triage is done when the issue has a priority and every open question or comment has a response.

### Triage a PR

Review the PR when all of the following are true:

- It is a minor change (such as a docs fix or a small bug fix with a test), or it addresses an issue that is assigned to the PR author.
- It does not overlap with work already in progress.
- It brings a change that the team can maintain long term.

You do not have to prove your decision is right; use your intuition.

If you decide to review it, help land it. If it is faster, create a superseding PR instead.

Otherwise, post the reply below and close the PR. The **Close with comment** button does both. You may want to add the reply to your [GitHub saved replies](https://docs.github.com/en/get-started/writing-on-github/working-with-saved-replies).

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

## Other resources

- [All items that need triage][needs-triage-all], including the ones that need team input.

[not-first-line-handled]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3A%22status%3A%20first-line-handled%22%20sort%3Acreated-asc
[needs-triage-all]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-triage%22
[needs-triage-minus-waiting]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-triage%22+-label%3A%22status%3A+needs-team-input%22
[needs-team-input]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+needs-team-input%22
[assigned-for-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+assigned-for-triage%22
[waiting-for-author-response]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen+sort%3Aupdated-asc+repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui+label%3A%22status%3A+waiting-for-author-response%22
[size-small]: https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20repo%3Aa2ui-project%2Fa2ui%20label%3A%22size%3A%20small%22
