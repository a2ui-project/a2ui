# Triage definitions

Terms used in [flagging.blueprint.md](features/flagging.blueprint.md) and [staleness_ping.blueprint.md](features/staleness_ping.blueprint.md).

## Contributors

1. A **team member** is anyone with the `OWNER`, `MEMBER` or `COLLABORATOR` association on the repository.
2. An **out-of-team contributor** is anyone else. Bots are out-of-team contributors, so an issue filed by a workflow or a PR opened by dependabot needs triage like any other.
3. The **triage bot** is the author of every comment that starts with `**From triage bot:**` and is posted from a team member's or bot's account.

## Automated jobs

**Flagger**:

- What: manages label `satus: needs-triage`
- When: when state of a GitHub item changed 
- Initiated by: githug workflow
- Required abilities: 
  - add/remove labels on GitHub
  - listent to GitHub items change

**Resolver**: 

- What:
   - Staleness pings
   - Triage recommendation comments 
- When: daily 
- Initiated-by: amplio agent
- Required abilities: 
  - access AI
  - send chat message

## Staleness pings

A **staleness ping** is a triage bot comment that the staleness-ping job posts on a stale item, marked with the item's case.

A ping is **current** when it was posted for the item's current case after that case's clock started: the latest `status: assigned-for-triage` labeling for case 1, or the last **out-of-team contributor** contribution for cases 2 and 3.

A current ping is **expired** when it is older than the grace period of its case.

## Stale items

An open issue or PR is **stale** when it matches one of these cases:

1. **Triage assignment.** It has `status: assigned-for-triage`, at least one assignee, and the label was last added more than 14 days ago. Grace period: 7 days.
2. **Inactive `P0`.** It is an issue with `P0`, at least one assignee, and no team member contribution for more than 1 day. Grace period: 1 day.
3. **Inactive `P1`.** It is an issue with `P1`, at least one assignee, and no team member contribution for more than 30 days. Grace period: 7 days.

In cases 2 and 3, staleness pings are not team member contributions. Otherwise each ping would restart the inactivity it reports, and the item would never be flagged.

An item with `status: assigned-for-triage` is checked against case 1 only. An item with `status: waiting-for-author-response` is never stale, because the team is waiting for someone outside it.
