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

- Link to the item.
- Related items (issues and PRs).
- Editable recommendation.
- Button 'Apply'






