# Core triage definitions

## Contributors

1. A **team member** is anyone with the `OWNER`, `MEMBER` or `COLLABORATOR` association on the repository.
2. An **out-of-team contributor** is anyone else. Bots are out-of-team contributors, so an issue filed by a workflow or a PR opened by dependabot needs triage like any other.
3. The **triage bot** is the author of every comment that starts with `**From triage bot:**` and is posted from a team member's or bot's account.

## Triage jobs

The following automations contribute to the triage process:

**Flagger**:

- What: manages label `satus: needs-triage`
- When: when state of a GitHub item changed 
- Initiated by: githug workflow
- Required abilities: 
  - add/remove labels on GitHub items
  - listen to GitHub items change

**Pinger**:
- What: reminds about stale items before they are flagged for triage
- When: daily, auto-scheduled
- Initiated by: triage agent
- Required abilities: 
  - comment GitHub items
  - send messages to team members

**Advisor**: 

- What: create triage recommendations as comments on GitHub items 
- When: daily, auto-scheduled
- Initiated-by: triage agent
- Required abilities: 
  - query an AI agent
  - comment GitHub items

**Triage UI**: 

- What: remove `satus: needs-triage` from GitHub items, by triager them 
- When: weekly, semi-manually
- Initiated-by: triager (himan)
- Required abilities: 
  - show UI
  - update GitHub items
