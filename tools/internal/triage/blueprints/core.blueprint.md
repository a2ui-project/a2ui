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

## Triage recommendation

Triage recommendation is a comment on a GitHub item with the following workflow:

1. Constructed by **Advisor** and ported to the item as a triage bot comment.
2. Parsed by **Triage UI** and showed to triager.
3. Optionally adjusted by triager.
4. Applied by **Triage UI** to the item.

The recommendation is structured as A2UI surface, that consists of one A2UI component TriageRecommendation  

The recommendation comment on GitHub is plain English plus hidden technical details as A2UI component in express format.

The comonent has the following properties:

- summary
- suggestion
- added_labels
- removed_labels
- new_assignees
- removed_assignees
- related_issues
- related_prs
