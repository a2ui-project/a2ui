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
2. How many items of the queue the triager handled, out of all of them, as in "5/45". A handled item is one whose suggestion the triager applied, including the items sent to the team.

### Items

The list of items holds the issues and PRs of [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui), and the PRs of [`flutter/genui`](https://github.com/flutter/genui), together in the same groups:

1. **New**: open items with `status: needs-triage` and without `status: needs-team-input`.
2. **Needs team input**: open items with `status: needs-team-input`.
3. **Not in the queue**: items that the triager opened from a [suggestion comment](triage_bot.blueprint.md#the-suggestion-comment) or by URL, and that are in neither group above.

The groups are set when the items load. An item that the triager adds `status: needs-team-input` to in this session stays in its group, and also shows in **Needs team input**, so it is listed twice until a refresh. The triager selects such an item in one of its groups, and only that copy shows as selected. The next item after **Apply** is the next one in that group that the triager has not handled yet, and after the end of the group, the next one in the groups below.

An item in `flutter/genui` shows "genui" before its number, as in "genui #12", because the two repositories number their items separately. The tool triages it as an item in `a2ui-project/a2ui`, except that its changes go to `flutter/genui`, and its label, assignee and milestone choices are those of `flutter/genui`. The triage bot comments only on `a2ui-project/a2ui`, so items in `flutter/genui` have no suggestion.

The groups list issues with open PRs first, then issues without open PRs, then PRs with linked issues, then PRs without linked issues. Each of these lists starts with the items that have a suggestion, current or outdated, and then the items without one. Within each of these, the least recently updated item comes first.

Each group and subgroup shows how many of its items the triager handled, out of all of them, as in "New (5/45)". Each group has a subgroup for each type of item it has. An open PR of an issue is any open PR linked to close the issue, whoever opened it. Closed and merged PRs do not count. The groups and the subgroups start collapsed. When the tool selects an item itself, such as an item opened from its suggestion comment or the next item after **Apply**, the list expands the item's group and subgroup, and scrolls to the item.

An item's flags show:

1. Whether it has a suggestion, and whether the suggestion is [current or outdated](triage_bot.blueprint.md#current-and-outdated-suggestions). A suggestion comment that does not parse counts as no suggestion.
2. Its linked PRs, for an issue, and its linked issues, for a PR.
3. `status: needs-team-input`.
4. Whether the triager has applied its suggestion in this session. An item whose applied suggestion adds `status: needs-team-input` shows a team icon instead, in both of its groups. While **Apply** is applying the item, a spinner shows in that place.

Issues are green and PRs are orange, in every group. Each type of item has its own icon:

- Issues with open PRs
- Issues without open PRs: an empty circle, for the missing PR.
- PRs with issues
- PRs without issues: a broken link, for the missing issue.

### Details

Tabs at the top: one for the selected item, and one for each linked PR or issue, whether or not it needs triage. An issue can have several linked PRs, and a PR several linked issues. A tab shows the item's icon and number, with "genui" before the number for an item in `flutter/genui`, and a blue dot when the triager edited its suggestion.

Each tab shows its item in two columns, on the page background, without a card frame:

1. On the left, what the triager should know about the item: its title, age, author, labels and assignees, notices about its state, the triage bot's `summary`, `reason` and `suggestion`, the comment for the team, and the related items.
2. On the right, two tabs, and **Apply** below them:
   - **Edit**: the rest of the [editable suggestion](#editable-suggestion), and **Revert**, which undoes the triager's changes to this item's suggestion. **Revert** is enabled when the suggestion has changes. If the last **Apply** of the item failed, the tab shows which changes it made and which failed.
   - **Log**: what the tool did to the item in this session, newest first, each with its time. For each **Apply**, the log lists every change in order, whether it was made, skipped, failed or not tried, why it failed, and the full text of the reply it posted. It also says when a refresh found that the item changed on GitHub and reset its suggestion. The tab shows how many entries the log has, as in "Log (2)".

The triager can drag the divider between the columns to resize them. Every tab and item keeps the new widths.

Nothing is selected when the tool starts, unless it starts with an item from a suggestion comment. Clicking the selected item again deselects it.

### Editable suggestion

The editable suggestion is the triage UI's implementation of the [`TriageSuggestion`](triage_bot.blueprint.md#the-triagesuggestion-component) A2UI component. It renders the component from the item's latest suggestion comment, or an empty one when the item has no suggestion.

The `summary`, the `reason` and the `suggestion` are shown as text in the left column, with each URL in them as a link that opens in the browser. Below them is the latest comment for the team, if the item has one: a comment by a team member that starts with `**From triager for team discussion:**`, as [triage.md](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager) asks the triager to write when they add `status: needs-team-input`. It is shown the same way, without the heading, under "From @login for team discussion", so the team reads the triager's question together with the triage bot's suggestion. The triager can change the other properties: the reply, how to close the item, the labels and the assignees. The triager also sets the item's priority, and its milestone, which the triage bot does not suggest.

1. The priority is a segmented button with `P0` to `P3`, without a field frame, with none or one of them selected. Selecting a priority adds its label and removes the item's other priority labels. Clicking the selected priority again removes them all. The other fields leave out the priority labels.
2. The triager checks the labels, people and milestone to add in a dropdown: the repository's labels, the people who can be assigned, and its open milestones. An item has at most one milestone, so checking one in its dropdown unchecks the other. The dropdown lists the checked options first. A dropdown with more than 7 options has a search field at the top.
3. The fields that remove things list what the item has, its labels, assignees and milestone, each with a checkbox. A checked one is grayed out. A field is not shown when the item has nothing of its kind. `status: needs-triage` starts checked, since a triaged item no longer needs it, and **Revert** checks it again. On a2ui, the [triage bot](../../../triage/blueprints/flagging.blueprint.md) adds the label back if the item still matches its rules. Nothing manages the label on genui, so the tool has to remove it there.

Labels have their colors from the repository, as on GitHub. The related issues and PRs are links, and the link to a closed item says "(closed)", or "(merged)" for a merged PR. Every link outside that text, and every button that opens a link, has a small **Copy link** button on its right.

**Apply**, in the right column of every tab, applies the suggestion of each item in the tabs to it on GitHub, skipping the suggestions that change nothing. If an item has `status: needs-team-input` and its suggestion does not add it, the tool also removes that label, as [triage.md](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager) asks once the item is triaged. `status: needs-team-input` is an ordinary label otherwise: the triager adds it with the other labels, and **Apply** adds it.

## CUJ

Ann is this week's triager.

### Go through the queue

1. Ann wants to triage GitHub items and opens the tool from VS Code, with the `triage_ui` launch configuration.
2. The header shows how many items Ann has handled, out of all of them: "0/45". The list on the left shows the **New** group, then the **Needs team input** group.
3. Ann selects the first item in **New**. The details show its suggestion, with a tab for it and for each linked item that needs triage.
4. Ann reads the summary, why the item is flagged and the suggestion, changes what to apply if needed, and clicks **Apply**.
5. The tool applies the suggestion to the item on GitHub, marks the item as applied in the list, and selects the next item.

Ann is done with the **New** group when every item in it is applied or [needs team input](#ask-the-team).

### Adjust a suggestion

The suggestion for an issue says P1, but Ann thinks the issue is P2.

1. Ann replaces `P1` with `P2` in the labels to add, and rewrites the reply.
2. Ann clicks **Apply**. The tool applies the edited suggestion, not the triage bot's original.

### Open an item from its suggestion comment

1. Ann reads an issue on GitHub and wants to triage it now.
2. Ann copies the command from the [suggestion comment](triage_bot.blueprint.md#the-suggestion-comment) and runs it in a terminal in the a2ui checkout.
3. If the tool is running, it shows the issue. Otherwise the command starts the tool with the issue.

The tool shows the item even if the item no longer has `status: needs-triage`.

### Triage an item without a suggestion

The triage bot has not commented on a new issue yet, or its comment does not parse. The list shows that the issue has no suggestion. When Ann selects it, the details show an empty suggestion. Ann fills it in and clicks **Apply**.

### Check an outdated suggestion

Someone commented on the item after the triage bot did, so the suggestion is [outdated](triage_bot.blueprint.md#current-and-outdated-suggestions). In the details, the "Suggestion" heading has a yellow "Outdated" label, as GitHub marks an outdated review comment. Ann opens the item from its title, reads the new comment on GitHub, adjusts the suggestion, and clicks **Apply**.

### Ask the team

Ann cannot triage an item in a couple of minutes, or the suggestion says that the triage bot could not decide. Ann adds `status: needs-team-input` to the labels, leaves out what the team should decide, writes a reply for the team that starts with `**From triager for team discussion:**`, and clicks **Apply**. The tool adds the label, posts the reply, and adds the item to the **Needs team input** group. The item also stays in its own group, with a team icon.

### Triage with the team

Ann goes through the **Needs team input** group with other team members. For each item, the details show Ann's comment for the team below the triage bot's suggestion. Then:

1. If they can triage it in a couple of minutes, Ann adjusts the suggestion and clicks **Apply**.
2. Otherwise, they pick an expert in the area. The triage bot suggests one from the commit history of the affected area (see [Suggested assignees](triage_bot.blueprint.md#suggested-assignees)). Ann adds `status: assigned-for-triage` to the labels, adds the expert to the assignees, and clicks **Apply**.

In both cases, the tool removes `status: needs-team-input` from the item.

### Close a duplicate

The suggestion is to close the issue as a duplicate of #1100. Ann opens #1100 from the related issues, confirms that it reports the same problem, and clicks **Apply**. The tool posts the reply and closes the issue as a duplicate of #1100.

### Triage an issue and its PR

An issue has a PR that fixes it, and both need triage. When Ann selects the issue, the details show a tab for each. Ann adjusts both suggestions and clicks **Apply** once, which applies both.

### Recover from a failed apply

Ann clicks **Apply**, and GitHub refuses to assign one of the assignees. The **Edit** tab shows which changes the tool made and which failed, and the **Log** tab keeps them after the next try. Ann removes the assignee and clicks **Apply** again. The tool does not post the reply a second time.

### Refresh the queue

While Ann works, a new issue arrives, and a team member triages another item on GitHub. Ann clicks **Refresh** in the hamburger menu. The list shows the new issue and drops the item that no longer has `status: needs-triage`. If the selected item changed on GitHub, the details show its current state, so Ann doesn't apply a suggestion to an old view of the item.

### Report the session

Ann wants to tell the team what was triaged.

1. Ann selects **Session report** in the hamburger menu.
2. A dialog shows the report as text. It starts with the numbers: how many items Ann triaged and how many of them were issues and PRs, how many items Ann sent to the team by adding `status: needs-team-input`, and how many items still need triage. Groups follow, by what Ann did: **Closed**, **Assigned P0** to **Assigned P3**, **Assigned for triage**, **Needs team input**, and **Updated** for the rest. Each group lists its items, with each item's URL, title and what Ann did.
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
    Stream partial updates to the Angular renderer: added status: needs-team-input, replied
```

If Ann closes the tool after applying suggestions, but without copying the report, the tool shows the report first, with two buttons: **Copy and close** and **Close**.
