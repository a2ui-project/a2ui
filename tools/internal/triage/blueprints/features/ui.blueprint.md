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
- needs teem input

Groups:

- New:
    - Issues
    - PRs with issues
    - PRs without issues

- Need team input:
    - Issues
    - PRs with issues
    - PRs without issues

Ordered by: update time (oldest first)

### Details

Editable recommendation for the selected item and all related items (linked PRs and issues) that needs triage.

### Editable recommendation

It is A2UI component implementation for TriageRecommenation that parses the recommendation on the item.

The recommendation is editable, there are buttons 'Apply', and 'Needs teem input'.

## CUJ

Ann is this week's triager.

### Go through the queue

1. Ann wants to triage GitHub items and opens the tool from VS Code, with the `triage_ui` launch configuration.
2. The header shows how many items need triage. The list on the left shows the issues first, then the PRs, oldest first.
3. Ann selects the first item. The details show its suggestion, and the suggestions for the related items that need triage.
4. Ann reads the summary and the suggestion, may be edits them, and clicks **Apply**.
5. The tool applies the suggestion to the item on GitHub, marks the item as applied in the list, and selects the next item.

Ann is done when every item in the list is applied.

### Adjust a suggestion

The suggestion for an issue says P1, but Ann thinks the issue is P2.

1. Ann replaces `P1` with `P2` in the labels to add, and rewrites the reply.
2. Ann clicks **Apply**. The tool applies the edited suggestion, not the advisor's original.

### Open an item from its suggestion comment

1. Ann reads an issue on GitHub and wants to triage it now.
2. Ann copies the command from the [suggestion comment](triage_item.blueprint.md#the-suggestion-comment) and runs it in a terminal in the a2ui checkout.
3. If the tool is running, it shows the issue. Otherwise the command starts the tool with the issue.

The tool shows the item even if the item no longer has `status: needs-triage`.

### Triage an item without a suggestion

The advisor has not commented on a new issue yet, or its comment does not parse. The list shows that the issue has no suggestion. When Ann selects it, the details show an empty suggestion. Ann fills it in and clicks **Apply**.

### Check an outdated suggestion

Someone commented on the item after the advisor did, so the suggestion is [outdated](triage_item.blueprint.md#current-and-outdated-suggestions). The details say so and link to the item. Ann reads the new comment on GitHub, adjusts the suggestion, and clicks **Apply**.

### Close a duplicate

The suggestion is to close the issue as a duplicate of #1100. Ann opens #1100 from the related items, confirms that it reports the same problem, and clicks **Apply**. The tool posts the reply and closes the issue as a duplicate of #1100.

### Triage an issue and its PR

An issue has a PR that fixes it, and both need triage. When Ann selects the issue, the details show the suggestions for both, and Ann applies each of them.

### Recover from a failed apply

Ann clicks **Apply**, and GitHub refuses to assign one of the assignees. The tool shows which changes it made and which failed. Ann removes the assignee and clicks **Apply** again. The tool does not post the reply a second time.

### Refresh the queue

While Ann works, a new issue arrives, and a team member triages another item on GitHub. Ann clicks **Refresh** in the hamburger menu. The list shows the new issue and drops the item that no longer has `status: needs-triage`. If the selected item changed on GitHub, the details show its current state, so Ann doesn't apply a suggestion to an old view of the item.

### Report the session

Ann wants to tell the team what was triaged.

1. Ann selects **Session report** in the hamburger menu.
2. A dialog shows the report as text. It starts with the numbers: how many items Ann applied, how many of them were issues and PRs, how many were closed, and how many items still need triage. A list follows with each applied item's number, title and what was applied.
3. Ann clicks **Copy** and pastes the report into the team chat.

For example:

```
Triaged 3 items: 2 issues and 1 PR. 
4 items still need triage.

- Closed: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4065
    Flutter renderer crashes on an empty Row: added P1, assigned octocat

- Assigned for triage: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4065
    Support dark theme in the Lit renderer: closed as duplicate of #1100

- Assigned P3: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4065
    Fix typo in the quickstart: added P3
```

If Ann closes the tool after applying items, but without copying the report, the tool shows the report first, with two buttons: **Copy and close** and **Close**.







