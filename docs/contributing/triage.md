# Triage for PRs and issues

go/a2ui-triage

See go/a2ui-triage for internal information.

## Goals

Continuously make sure that on [a2ui](https://github.com/a2ui-project/a2ui):

1. External PRs are addressed
2. Issues are prioritized and addressed
3. Number of branches is observable

## Invariant we want to keep

This section describes goals at a high level. See concrete steps in the section [Triage responsibilities](#triage-responsibilities).

1. **Issues** priority (aligned with other teams in Dash):
    - **P0**: very urgent, should be assigned
    - **P1**: we are actively working on it, should be assigned
    - **P2**: is expected to be converted to P1 within quarter, as part of regular planning process
    - **P3**: not planned, but we will accept contributions
    - **P4**: we do not plan to invest into it, no PRs will be reviewed
2. **PRs**: We will review PRs from external contributors if they contribute to a **P0-P3** issue that is assigned to the contributor (the issue should be linked in the first line of description).  
   **Exception**: the change is absolutely clear and obviously needed.
3. **Branches**: [list of stale branches](https://github.com/a2ui-project/a2ui/branches/stale) should fit on one screen and should not have a button ‘Next’.

## GitHub labels used in triage

1. P0-P4
2. status: in-discussion
3. status: needs-triage
4. status: first-line-handled
5. size: small
6. status: waiting-for-author-response

See [all github labels](https://github.com/a2ui-project/a2ui/labels).

Two of these are automated by [scripts/triage.mjs](../../scripts/triage.mjs): `status: needs-triage` is added and removed entirely by the bot, and `status: waiting-for-author-response` is applied by hand — while it is set the item stays out of the triage queue, and the bot removes it once the author has posted a reply, review, or review comment after the label went on. Replies from anyone else do not clear it, and neither does the author pushing commits without saying anything; remove it by hand in those cases.

## Triage responsibilities

### First line triage

For each issue that is [not first-line-handled](https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20-label%3AP0%20-label%3AP1%20-label%3AP2%20-label%3AP3%20-label%3A%22status%3A%20first-line-handled%22):

- If it is P0, add label `P0` and notify team chat
- Add label `status: first-line-handled`

### Second line triage

Push forward items [with label `status: needs-triage`][needs-triage], temporarily adding `status: in-discussion` for items that are [actively discussed by the team][in-discussion].

Push forward means to address each item until it no longer matches a [flagging rule](../../scripts/triage.mjs): set a priority, assign P0/P1, answer the external comment, or add `status: waiting-for-author-response` when you need more information. The label is owned by the automation and disappears on its next run. Removing it by hand just speeds that up — if the item still matches a rule, it comes back within a minute.

Use [standard replies](triage-templates.md) that are provided for standard cases.

[needs-triage]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20label%3A%22status%3A%20needs-triage%22%20repo%3Aa2ui-project%2Fa2ui%2Cflutter%2Fgenui%20-label%3A%22status%3A%20in-discussion%22%20sort%3Aupdated-asc%20-label%3A%22status%3A%20waiting-for-user-response%22
[in-discussion]: https://github.com/a2ui-project/a2ui/issues?q=state%3Aopen%20label%3A%22status%3A%20in-discussion%22

See internal steps in: go/a2ui-oncall-notes-template.

## AI assistance

Use this skill to get agent's help with triage process: [.agents/skills/a2ui-issue-triage](../../.agents/skills/a2ui-issue-triage/SKILL.md).

It forks multiple subagents (one for each issue) to try and tries to reproduce the issue if it is something that can be easily reproduced. It won't attempt to repro something that takes a lot of setup.

## Q\&A

This tab contains explanations behind decisions made for the triage process.

### Why do we allow branches on the repo and thus create work for on-call?

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
