# Triage UI

Status: under construction.

The triage UI is a Flutter application that helps the triager to triage. The terms are defined in [core.blueprint.md](../core.blueprint.md).

The triager runs it weekly, as part of [second line triage](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager).

## Layout

The main parts of the UI:

1. The header, at the top.
2. The items, on the left.
3. The details, on the right.

The triager can drag the divider between the items and the details to resize them.

### Header

1. The hamburger menu, with **Refresh** and **Session report**.
2. The number of items that need triage.

### Items

The list of items, in groups:

1. **New**: open items with `status: needs-triage` and without `status: needs-team-input`.
2. **Needs team input**: open items with `status: needs-team-input`.
3. **Not in the queue**: items that the triager opened from a [suggestion comment](triage_item.blueprint.md#the-suggestion-comment) and that are in neither group above.

Each group lists issues first, then PRs with linked issues, then PRs without linked issues. Each of these lists starts with the items that have a suggestion, current or outdated, and then the items without one. Within each of these, the least recently updated item comes first.

Each group has a subgroup for each type of item it has. The groups and the subgroups start collapsed. When the tool selects an item itself, such as an item opened from its suggestion comment or the next item after **Apply**, the list expands the item's group and subgroup, and scrolls to the item.

An item's flags show:

1. Whether it has a suggestion, and whether the suggestion is [current or outdated](triage_item.blueprint.md#current-and-outdated-suggestions). A suggestion comment that does not parse counts as no suggestion.
2. Its linked PRs, for an issue, and its linked issues, for a PR.
3. `status: needs-team-input`.
4. Whether the triager has applied its suggestion in this session.

Items are colored differently by types:

- Issues
- PRs with issues
- PRs without issues

### Details

The editable suggestion for the selected item, followed by an editable suggestion for each linked PR or issue that needs triage.

### Editable suggestion

The editable suggestion is the triage UI's implementation of the [`TriageSuggestion`](triage_item.blueprint.md#the-triagesuggestion-component) A2UI component. It renders the component from the item's suggestion comment, or an empty one when the item has no suggestion.

The `summary` and the `suggestion` are shown as text. The triager can change the other properties: the reply, how to close the item, the labels and the assignees. The triager types labels and logins, or checks them in a dropdown of the possible options: the repository's labels and the people who can be assigned for the labels and assignees to add, and the item's own labels and assignees for the ones to remove. The related issues and PRs are links.

There are two buttons:

1. **Apply** applies the suggestion to the item on GitHub. If the item has `status: needs-team-input` and the suggestion does not add it, the tool also removes that label, as [triage.md](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager) asks once the item is triaged.
2. **Needs team input** adds `status: needs-team-input` to the item, and posts the triager's comment if they write one. It does not apply the suggestion. The button is shown only for items without the label.

## CUJ

Ann is this week's triager.

### Go through the queue

1. Ann wants to triage GitHub items and opens the tool from VS Code, with the `triage_ui` launch configuration.
2. The header shows how many items need triage. The list on the left shows the **New** group, then the **Needs team input** group.
3. Ann selects the first item in **New**. The details show its suggestion, and the suggestions for the linked items that need triage.
4. Ann reads the summary and the suggestion, changes what to apply if needed, and clicks **Apply**.
5. The tool applies the suggestion to the item on GitHub, marks the item as applied in the list, and selects the next item.

Ann is done with the **New** group when every item in it is applied or [needs team input](#ask-the-team).

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

### Ask the team

Ann cannot triage an item in a couple of minutes, or the suggestion says that the advisor could not decide. Ann clicks **Needs team input** and writes a comment for the team. The tool adds `status: needs-team-input`, posts the comment, and moves the item to the **Needs team input** group.

### Triage with the team

Ann goes through the **Needs team input** group with other team members. For each item:

1. If they can triage it in a couple of minutes, Ann adjusts the suggestion and clicks **Apply**.
2. Otherwise, they pick an expert in the area. Ann adds `status: assigned-for-triage` to the labels, adds the expert to the assignees, and clicks **Apply**.

In both cases, the tool removes `status: needs-team-input` from the item.

### Close a duplicate

The suggestion is to close the issue as a duplicate of #1100. Ann opens #1100 from the related issues, confirms that it reports the same problem, and clicks **Apply**. The tool posts the reply and closes the issue as a duplicate of #1100.

### Triage an issue and its PR

An issue has a PR that fixes it, and both need triage. When Ann selects the issue, the details show the suggestions for both, and Ann applies each of them.

### Recover from a failed apply

Ann clicks **Apply**, and GitHub refuses to assign one of the assignees. The tool shows which changes it made and which failed. Ann removes the assignee and clicks **Apply** again. The tool does not post the reply a second time.

### Refresh the queue

While Ann works, a new issue arrives, and a team member triages another item on GitHub. Ann clicks **Refresh** in the hamburger menu. The list shows the new issue and drops the item that no longer has `status: needs-triage`. If the selected item changed on GitHub, the details show its current state, so Ann doesn't apply a suggestion to an old view of the item.

### Report the session

Ann wants to tell the team what was triaged.

1. Ann selects **Session report** in the hamburger menu.
2. A dialog shows the report as text. It starts with the numbers: how many items Ann triaged and how many of them were issues and PRs, how many items Ann sent to the team, and how many items still need triage. Groups follow, by what Ann did: **Closed**, **Assigned P0** to **Assigned P3**, **Assigned for triage**, **Needs team input**, and **Updated** for the rest. Each group lists its items, with each item's URL, title and what Ann did.
3. Ann clicks **Copy** and pastes the report into the team chat.

For example:

```
Triaged 3 items: 2 issues and 1 PR.
Sent 1 issue to the team.
4 items still need triage.

- Closed: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4065
    Add a Slider to the Lit renderer: closed, replied

- Assigned for triage: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4071
    Support dark theme in the Lit renderer: added status: assigned-for-triage, assigned octocat

- Assigned P3: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4080
    Fix typo in the quickstart: added P3

- Needs team input: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4082
    Stream partial updates to the Angular renderer: added status: needs-team-input, commented
```

If Ann closes the tool after triaging items or sending them to the team, but without copying the report, the tool shows the report first, with two buttons: **Copy and close** and **Close**.
