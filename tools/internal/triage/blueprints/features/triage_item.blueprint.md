# Triage item

## Triage recommendation

Triage recommendation is a comment on a GitHub item with the following workflow:

1. Advisor:
  a. Construct the recommendation using the skill [a2ui-triage-item](../../../../../.agents/skills/a2ui-triage-item)
  b. Format the recommendation as A2UI component TriageRecommendation
  c. Comment to the GitHub item as plain English plus hidden technical details in express format.
2. Triage UI:
  a. Parse from GitHub item comment
  b. Show to triager
  b. Finalize by collaborating with the triager
  c. Apply to the item

## The component TriageRecommendation

The A2UI comonent TriageRecommendation has the following properties:

- summary
- suggestion
- added_labels
- removed_labels
- new_assignees
- removed_assignees
- related_issues
- related_prs
