# A2UI Standard Triage Replies for Pull Requests

Canonical replies for recurring PR triage cases. For issues, see [templates-issues.md](templates-issues.md).

## Complex PR without an associated issue

**Case**: A complex PR that does not address an issue. Straightforward and minor PRs are exempt.

**Triage**: close the PR.

Thank you for your contribution. Unfortunately, we must decline this PR at this time.  
Our team resources are limited, and our policy is to prioritize the review of PRs that address an existing issue prioritized issues. Consider opening issue  
and link your PR in the issue description as one of the options for resolution.

## PR outside the project's scope

**Case**: The change targets functionality the maintenance team cannot support long-term.

**Triage**: close the PR.

Thank you for your contribution to the A2UI ecosystem! Unfortunately, we must decline this PR as the scope of this repository is restricted to features the maintenance team can support long-term. We encourage you to find a more suitable repository for this code or to consider launching your own repository to support this segment of the A2UI ecosystem.

## Complex PR towards existing issue but not assigned to the author

**Case**: Complex PR that is not assigned to the author.  
It might be a good contribution, but we do not have enough bandwidth to review it at this time.

**Triage**: close the PR.

Thank you for your contribution to the A2UI ecosystem! Unfortunately, we must decline this PR at this time: we review PRs against an issue only from the contributor the issue is assigned to, and this one is not assigned to you. Issues are assigned in priority order, so we cannot say yet when this one will be picked up.

We will link this PR to the issue, so whoever takes it on can see your approach. They may reopen this PR and build on it rather than start from scratch.

## Meaningful stale PR with conflicts

**Case**: The PR is meaningful, but has conflicts with the main branch.

**Triage**: assign `status: waiting-for-user-response`.

Thank you for your contribution. I am sorry it took long for our team to review your PR. Unfortunately the branch has conflicts with the main branch. If you believe the issue is not resolved yet, can you, please, resolve the conflicts? We will review it again after you resolve conflicts.

## PR that closes already closed issue

**Case**: The PR closes an issue that has already been closed.

**Triage**: close the PR.

Thank you for your contribution. I am closing this PR as the linked issue has already been resolved.

## Superseded PR

**Case**: A valid contribution that has gone stale and you replaced it by a newer PR carrying
the original commit.

**Triage**: close the PR, linking the superseding one.

Thank you for your contribution! We apologize that this PR has become outdated. To
expedite the process, I created a superseding PR based on your analysis and changes. Your
original commit is included to ensure your contribution is properly recorded.
`<link to new PR>`
