# Triage item

## Triage suggestion

Triage suggestion is a comment on a GitHub item with the following workflow:

1. The skill [a2ui-triage-advisor](../../../../../.agents/skills/a2ui-triage-advisor/SKILL.md), for each GitHub item marked with `status: needs triage` (or for concreate items specified in prompt), without suggestion or with outdated suggestion: 
  b. Constructs the suggestion in native english 
  b. Formats the suggestion as [A2UI component TriageSuggestion](../../pkgs/triage/lib/src/triage_item/triage_suggestion.dart)
  c. Posts the suggestion as a comment to the item
2. Triage UI:
  a. Parses the suggestion from GitHub item comment
  b. Shows it to triager
  b. Finalizes it by collaborating with the triager
  c. Applies to the item when triager clicks 'Apply'

## Suggestion comment

The suggestion comment on a GitHub itam looks as follows:

```
**From triage bot:**

## Triage suggestion

<TriageSuggestion in plain english>

<details>
  <summary>Details</summary>

    <a2ui>
    <TriageSuggestion in express format>
    </a2ui>

</details>
```

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
