# A2UI Standard Triage Replies

Canonical replies for recurring triage cases.

## Issues

### Weekly A2UI Compliance Report

**Case**: AI-generated compliance report issues, such as
[Weekly A2UI Compliance Report](https://github.com/a2ui-project/a2ui/issues/2025).

**Triage**: priority `P3`, action `backlog` (keeps the issue open).

As agreed, this has been assigned a P3 priority: we need better workflow to make it easier to follow up on the findings.

### Assigned issue without a priority

**Case**: The issue already has an assignee but no priority label, so it sits in the triage
queue with nothing else to decide.

**Triage**: priority `P2`, action `assign_and_fix`, keeping the existing assignee.

I assigned a P2 priority to move this out of the triage queue. Please adjust the priority
if needed to better reflect the issue's status.

### Stale P2 issue

**Case**: The issue is P2 but stale.

**Triage**: add comment.

This issue should be considered for a P1 priority together with other P2 issues in the next planning cycle after we burn through the triage queue.

### Stale assigned P1 issue

**Case**: The issue is P1 and has an assignee, but has been stale for a while.

**Triage**: add comment.

Ping from triage process: is this issue still on your radar?

### Out of Scope / Roadmap Conflict

**Case**: The user suggests a feature or change that is outside the current scope of the A2UI protocol roadmap.

**Triage**: priority `P4`, action `backlog` (keeps the issue open).

Thanks for the suggestion. This falls outside the current scope of the A2UI protocol roadmap.

Marked as `P4`: we do not plan to invest in it, and PRs against it will not be reviewed. Leaving it open as a record of the request — comment here if you have new arguments to share.

## Pull requests

These cases are handled by the gardener directly. The dashboard and apply script
cover issues only, so the actions below are performed by hand.

### Superseded PR

**Case**: A valid contribution that has gone stale and was replaced by a newer PR carrying
the original commit.

**Triage**: close the PR, linking the superseding one.

Thank you for your contribution! We apologize that this PR has become outdated. To
expedite the process, I created a superseding PR based on your analysis and changes. Your
original commit is included to ensure your contribution is properly recorded.
`<link to new PR>`

### Complex PR without an associated issue

**Case**: A complex PR that does not address an issue. Straightforward and minor PRs are exempt.

**Triage**: close the PR.

Thank you for your contribution. Unfortunately, we must decline this PR at this time.  
Our team resources are limited, and our policy is to prioritize the review of PRs that address an existing issue prioritized issues. Consider opening issue  
and link your PR in the issue description as one of the options for resolution.

### PR outside the project's scope

**Case**: The change targets functionality the maintenance team cannot support long-term.

**Triage**: close the PR.

Thank you for your contribution to the A2UI ecosystem! Unfortunately, we must decline this PR as the scope of this repository is restricted to features the maintenance team can support long-term. We encourage you to find a more suitable repository for this code or to consider launching your own repository to support this segment of the A2UI ecosystem.

### Complex PR towards existing issue but not assigned to the author

**Case**: Complex PR that is not assigned to the author.  
It might be a good contribution, but we do not have enough bandwidth to review it at this time.

**Triage**: close the PR.

Thank you for your contribution to the A2UI ecosystem! Unfortunately, we must decline this PR at this time: we review PRs against an issue only from the contributor the issue is assigned to, and this one is not assigned to you. Issues are assigned in priority order, so we cannot say yet when this one will be picked up.

We will link this PR to the issue, so whoever takes it on can see your approach. They may reopen this PR and build on it rather than start from scratch.

### Meaningful stale PR with conflicts

**Case**: The PR is meaningful, but has conflicts with the main branch.

**Triage**: assign `status: waiting-for-user-response`.

Thank you for your contribution. I am sorry it took so long for our team to review your PR. Unfortunately the branch has conflicts with the main branch. If you believe the issue is not resolved yet, can you, please, resolve the conflicts? We will review it again after you resolve conflicts.

### PR that closes already closed issue

**Case**: The PR closes an issue that has already been closed.

**Triage**: close the PR.

Thank you for your contribution. I am closing this PR as the linked issue has already been resolved.
