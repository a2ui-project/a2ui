# Triage item

## Triage suggestion

Triage suggestion is a comment on a GitHub item with the following workflow:

1. Advisor (skill [a2ui-triage-advisor](../../../../../.agents/skills/a2ui-triage-advisor)), for each item marked with `status: needs triage` (or for concreate items specified in prompt), without suggestion or with outdated suggestion: 
  b. Constructs the suggestion in native english 
  b. Format the suggestion as A2UI component Triagesuggestion
  c. Comment to the GitHub item as plain English plus hidden technical details in express format.
2. Triage UI:
  a. Parse the suggestion from GitHub item comment
  b. Show it to triager
  b. Finalize it by collaborating with the triager
  c. Apply to the item

## suggestion comment

The suggestion comment 


## The component TriageSuggestion

The A2UI comonent Triagesuggestion has the following properties:

- summary
- suggestion
- added_labels
- removed_labels
- new_assignees
- removed_assignees
- related_issues
- related_prs
