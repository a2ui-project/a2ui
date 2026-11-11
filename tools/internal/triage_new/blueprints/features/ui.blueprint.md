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
3. **Not in the queue**: items that the triager opened from a [suggestion comment](advisor.blueprint.md#the-suggestion-comment) and that are in neither group above.
4. **PRs on genui**: open PRs in [`flutter/genui`](https://github.com/flutter/genui) with `status: needs-triage`, least recently updated first. Each PR shows its number, title and when it was last updated. The tool does not triage these PRs, and they do not count in the number of items that need triage. When the triager selects one, the details show a card that is not editable: the PR's title, with a link to it on GitHub, its age, when it was last updated, its author, labels and assignees.

The first three groups list issues with open PRs first, then issues without open PRs, then PRs with linked issues, then PRs without linked issues. Each of these lists starts with the items that have a suggestion, current or outdated, and then the items without one. Within each of these, the least recently updated item comes first.

Each of the first three groups has a subgroup for each type of item it has. An open PR of an issue is any open PR linked to close the issue, whoever opened it. Closed and merged PRs do not count. The groups and the subgroups start collapsed. When the tool selects an item itself, such as an item opened from its suggestion comment or the next item after **Apply**, the list expands the item's group and subgroup, and scrolls to the item.

An item's flags show:

1. Whether it has a suggestion, and whether the suggestion is [current or outdated](advisor.blueprint.md#current-and-outdated-suggestions). A suggestion comment that does not parse counts as no suggestion.
2. Its linked PRs, for an issue, and its linked issues, for a PR.
3. `status: needs-team-input`.
4. Whether the triager has applied its suggestion in this session.

Issues are green and PRs are orange, in every group. Each type of item has its own icon:

- Issues with open PRs
- Issues without open PRs: an empty circle, for the missing PR.
- PRs with issues
- PRs without issues: a broken link, for the missing issue.

### Details

Tabs at the top: one for the selected item, and one for each linked PR or issue, whether or not it needs triage. An issue can have several linked PRs, and a PR several linked issues. A tab shows the item's icon and number, and a blue dot when the triager edited its suggestion.

Each tab shows its item and its editable suggestion, on the page background, without a card frame.

Below the tabs are the buttons, which act on all the items in the tabs together.

Nothing is selected when the tool starts, unless it starts with an item from a suggestion comment. Clicking the selected item again deselects it.

### Editable suggestion

The editable suggestion is the triage UI's implementation of the [`TriageSuggestion`](advisor.blueprint.md#the-triagesuggestion-component) A2UI component. It renders the component from the item's suggestion comment, or an empty one when the item has no suggestion.

The `summary`, the `reason` and the `suggestion` are shown as text. The triager can change the other properties: the reply, how to close the item, the labels and the assignees. The triager also sets the item's priority, and its milestone, which the advisor does not suggest.

1. The priority is a segmented button with `P0` to `P3`, without a field frame, with none or one of them selected. Selecting a priority adds its label and removes the item's other priority labels. Clicking the selected priority again removes them all. The other fields leave out the priority labels.
2. The triager checks the labels, people and milestone to add in a dropdown: the repository's labels, the people who can be assigned, and its open milestones. An item has at most one milestone, so checking one in its dropdown unchecks the other. The dropdown lists the checked options first. A dropdown with more than 7 options has a search field at the top.
3. The fields that remove things list what the item has, its labels, assignees and milestone, each with a checkbox. A checked one is grayed out. A field is not shown when the item has nothing of its kind.

Labels have their colors from the repository, as on GitHub. The related issues and PRs are links, and the link to a closed item says "(closed)", or "(merged)" for a merged PR. Every link, and every button that opens a link, has a small **Copy link** button on its right.

The buttons below the tabs:

1. **Apply** applies the suggestion of each item in the tabs to it on GitHub, skipping the suggestions that change nothing. If an item has `status: needs-team-input` and its suggestion does not add it, the tool also removes that label, as [triage.md](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager) asks once the item is triaged.
2. **Needs team input** adds `status: needs-team-input` to the selected item and to the linked items that need triage, the ones that do not have the label yet, and posts the triager's comment on each, if they write one. It does not apply the suggestions. The button is shown only when one of these items does not have the label.
3. **Revert** undoes the triager's changes to the suggestions in all tabs. It is enabled when a tab has changes.

## CUJ

Ann is this week's triager.

### Go through the queue

1. Ann wants to triage GitHub items and opens the tool from VS Code, with the `triage_ui` launch configuration.
2. The header shows how many items need triage. The list on the left shows the **New** group, then the **Needs team input** group.
3. Ann selects the first item in **New**. The details show its suggestion, with a tab for it and for each linked item that needs triage.
4. Ann reads the summary, why the item is flagged and the suggestion, changes what to apply if needed, and clicks **Apply**.
5. The tool applies the suggestion to the item on GitHub, marks the item as applied in the list, and selects the next item.

Ann is done with the **New** group when every item in it is applied or [needs team input](#ask-the-team).

### Adjust a suggestion

The suggestion for an issue says P1, but Ann thinks the issue is P2.

1. Ann replaces `P1` with `P2` in the labels to add, and rewrites the reply.
2. Ann clicks **Apply**. The tool applies the edited suggestion, not the advisor's original.

### Open an item from its suggestion comment

1. Ann reads an issue on GitHub and wants to triage it now.
2. Ann copies the command from the [suggestion comment](advisor.blueprint.md#the-suggestion-comment) and runs it in a terminal in the a2ui checkout.
3. If the tool is running, it shows the issue. Otherwise the command starts the tool with the issue.

The tool shows the item even if the item no longer has `status: needs-triage`.

### Triage an item without a suggestion

The advisor has not commented on a new issue yet, or its comment does not parse. The list shows that the issue has no suggestion. When Ann selects it, the details show an empty suggestion. Ann fills it in and clicks **Apply**.

### Check an outdated suggestion

Someone commented on the item after the advisor did, so the suggestion is [outdated](advisor.blueprint.md#current-and-outdated-suggestions). The details say so and link to the item. Ann reads the new comment on GitHub, adjusts the suggestion, and clicks **Apply**.

### Ask the team

Ann cannot triage an item in a couple of minutes, or the suggestion says that the advisor could not decide. Ann clicks **Needs team input** and writes a comment for the team. The tool adds `status: needs-team-input`, posts the comment, and moves the item to the **Needs team input** group.

### Triage with the team

Ann goes through the **Needs team input** group with other team members. For each item:

1. If they can triage it in a couple of minutes, Ann adjusts the suggestion and clicks **Apply**.
2. Otherwise, they pick an expert in the area. The advisor suggests one from the commit history of the affected area (see [Suggested assignees](advisor.blueprint.md#suggested-assignees)). Ann adds `status: assigned-for-triage` to the labels, adds the expert to the assignees, and clicks **Apply**.

In both cases, the tool removes `status: needs-team-input` from the item.

### Close a duplicate

The suggestion is to close the issue as a duplicate of #1100. Ann opens #1100 from the related issues, confirms that it reports the same problem, and clicks **Apply**. The tool posts the reply and closes the issue as a duplicate of #1100.

### Triage an issue and its PR

An issue has a PR that fixes it, and both need triage. When Ann selects the issue, the details show a tab for each. Ann adjusts both suggestions and clicks **Apply** once, which applies both.

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
