# Triage UI

Status: under construction.

The triage UI is a Flutter application that helps the triager to triage. The terms are defined in [core.blueprint.md](../core.blueprint.md).

The triager runs it weekly, as part of [second line triage](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager). 

## Layout

Main UI elements:

- Header
- Items (at the laft)
- Details (at the right)

### Header

- hamburger menu
- number of items

### Items

List of items with label "status: needs triage". 

Types:
- Issue
- PR

Flags: 
- has recommendation
- has PR (for issues)
- has issue (for PRs)

Ordered by: type and time (olderst first)

### Details

Editable recommendation for the selected item and all related items (linked PRs and issues) that needs triage.

### Editable recommendation

It is A2UI component implementation for TriageRecommenation that parses the recommendation on the item.

The recommendation is editable, there is button 'Apply'.

## CUJ

Ann wants to triage GitHub items and opens the tool.








