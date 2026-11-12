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

1. The hamburger menu, with **Create report**.
2. **Refresh**, which loads the items from GitHub again.
3. **Hide triaged**, which takes the triaged items out of the list. See [Hide the triaged items](#hide-the-triaged-items).
4. How many items of the queue the triager has not handled yet, out of all of them, as in "40/45". A handled item is one whose suggestion the triager applied, including the items sent to the team.

### Items

The list of items holds the issues and PRs of [`a2ui-project/a2ui`](https://github.com/a2ui-project/a2ui), and the PRs of [`flutter/genui`](https://github.com/flutter/genui), together in the same groups:

1. **Needs triage**: open items with `status: needs-triage` and without `status: needs-team-input`.
2. **Needs team input**: open items with `status: needs-team-input`.
3. **Not in the queue**: items that the triager opened from a [suggestion comment](triage_bot.blueprint.md#the-suggestion-comment) or by URL, and that are in neither group above.

The groups are set when the items load. An item that the triager adds `status: needs-team-input` to in this session stays in its group, and also shows in **Needs team input**, so it is listed twice until a refresh or **Hide triaged**. The triager selects such an item in one of its groups, and only that copy shows as selected. The next item after **Apply** is the next one in that group that the triager has not handled yet, and after the end of the group, the next one in the groups below.

An item in `flutter/genui` shows "genui" before its number, as in "genui #12", because the two repositories number their items separately. The tool triages it as an item in `a2ui-project/a2ui`, except that its changes go to `flutter/genui`, and its label, assignee and milestone choices are those of `flutter/genui`. The triage bot comments only on `a2ui-project/a2ui`, so items in `flutter/genui` have no suggestion.

The groups list issues with open PRs first, then issues without open PRs, then PRs with linked issues, then PRs without linked issues. Each of these lists starts with the items that have a suggestion, current or outdated, and then the items without one. Within each of these, the least recently updated item comes first.

Each group and subgroup shows how many of its items the triager has not handled yet, out of all of them, as in "Needs triage (40/45)". Each group has a subgroup for each type of item it has. An open PR of an issue is any open PR linked to close the issue, whoever opened it. Closed and merged PRs do not count. The groups and the subgroups start collapsed. When the tool selects an item itself, such as an item opened from its suggestion comment or the next item after **Apply**, the list expands the item's group and subgroup, and scrolls to the item.

An item's flags show:

1. Whether its suggestion is [outdated](triage_bot.blueprint.md#current-and-outdated-suggestions), or it has none. A suggestion comment that does not parse counts as no suggestion. Most items have a current suggestion, so a current one has no flag.
2. Its linked PRs, for an issue, and its linked issues, for a PR.
3. `status: needs-team-input`, except in the **Needs team input** group.
4. Whether the triager has applied its suggestion in this session. An item whose applied suggestion adds `status: needs-team-input` shows a team icon instead, in both of its groups. While **Apply** is applying the item, a spinner shows in that place, and if some of its changes failed, an error icon.

Issues are green and PRs are orange, in every group. Each type of item has its own icon:

- Issues with open PRs
- Issues without open PRs: an empty circle, for the missing PR.
- PRs with issues
- PRs without issues: a broken link, for the missing issue.

### Details

Tabs at the top: one for the selected item, and one for each linked PR or issue, whether or not it needs triage. An issue can have several linked PRs, and a PR several linked issues. A tab shows the item's icon and number, with "genui" before the number for an item in `flutter/genui`, and a blue dot when the triager edited its suggestion.

To the left of the tabs, **Locate in the list** expands the selected item's group and subgroup in the list, and scrolls to the item, as when the tool selects an item itself.

To the right of the tabs, **Copy context** copies what the tool knows about the items in the tabs, the selected item first, as Markdown that the triager pastes at the start of a prompt to an agent. For each item, it has the item's URL, state, author, dates, labels, assignees, milestone and linked items, its description, its last 100 comments without the triage bot's suggestion comments, the triage bot's suggestion, and the changes that **Apply** would make, including the triager's edits.

Each tab shows its item in two columns, on the page background, without a card frame:

1. On the left, what the triager should know about the item: its title, age, author, labels and assignees, notices about its state, the triage bot's `summary`, `reason` and `suggestion`, the comment for the team, and the related items.
2. On the right, two tabs, and **Apply** below them:
   - **Edit**: the rest of the [editable suggestion](#editable-suggestion), and **Revert** at the bottom, which undoes the triager's changes to this item's suggestion. **Revert** is enabled when the suggestion has changes. If the last **Apply** of the item failed, the tab shows which changes it made and which failed.
   - **Log**: what the tool did to the item in this session, newest first, each with its time. For each **Apply**, the log lists every change in order, whether it was made, skipped, failed or not tried, why it failed, and the full text of the reply it posted. It also says when a refresh found that the item changed on GitHub and reset its suggestion. The tab shows how many entries the log has, as in "Log (2)".

The triager can drag the divider between the columns to resize them. Every tab and item keeps the new widths.

Nothing is selected when the tool starts, unless it starts with an item from a suggestion comment. Clicking the selected item again deselects it.

### Editable suggestion

The editable suggestion is the triage UI's implementation of the [`TriageSuggestion`](triage_bot.blueprint.md#the-triagesuggestion-component) A2UI component. It renders the component from the item's latest suggestion comment, or an empty one when the item has no suggestion.

The `summary`, the `reason` and the `suggestion` are shown in the left column as GitHub-flavored Markdown. Their links and bare URLs open in the browser. Below them is the latest comment for the team, if the item has one: a comment by a team member that starts with `**Requires team input. Note for the discussion:**`, as [triage.md](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager) asks the triager to write when they add `status: needs-team-input`. It is shown the same way, without the heading, under "From @login for team discussion", so the team reads the triager's question together with the triage bot's suggestion. The triager can change the other properties: the reply, how to close the item, the labels and the assignees. The triager also sets the item's priority, and its milestone, which the triage bot does not suggest.

1. The priority is a segmented button with `P0` to `P3`, without a field frame, with none or one of them selected. Selecting a priority adds its label and removes the item's other priority labels. Clicking the selected priority again removes them all. The other fields leave out the priority labels.
2. The triager checks the labels, people and milestone to add in a dropdown: the repository's labels, the people who can be assigned, and its open milestones. An item has at most one milestone, so checking one in its dropdown unchecks the other. The dropdown lists the checked options first. In the labels to add, `status: needs-team-input` comes next, before the other labels. A dropdown with more than 7 options has a search field at the top.
3. The fields that remove things list what the item has, its labels, assignees and milestone, each with a checkbox. A checked one is grayed out. A field is not shown when the item has nothing of its kind. `status: needs-triage` starts checked, since a triaged item no longer needs it, and **Revert** checks it again. On a2ui, the [triage bot](../../../triage/blueprints/flagging.blueprint.md) adds the label back if the item still matches its rules. Nothing manages the label on genui, so the tool has to remove it there.

Labels have their colors from the repository, as on GitHub. The related issues and PRs are links, and the link to a closed item says "(closed)", or "(merged)" for a merged PR. Every link outside that text, and every button that opens a link, has a small **Copy link** button on its right.

**Apply**, in the right column of every tab, applies the suggestion of each item in the tabs to it on GitHub, skipping the suggestions that change nothing. When more than one item has changes, the button says how many, as in "Apply to 2 items", since **Revert** acts on one tab and **Apply** on all of them. `status: needs-team-input` is an ordinary label: the triager adds or removes it with the other labels, and **Apply** applies that.

## CUJ

Ann is this week's triager.

### Go through the queue

1. Ann wants to triage GitHub items and opens the tool from VS Code, with the `triage_ui` launch configuration.
2. The header shows how many items Ann has not handled yet, out of all of them: "45/45". The list on the left shows the **Needs triage** group, then the **Needs team input** group.
3. Ann selects the first item in **Needs triage**. The details show its suggestion, with a tab for it and for each linked item that needs triage.
4. Ann reads the summary, why the item is flagged and the suggestion, changes what to apply if needed, and clicks **Apply**.
5. The tool selects the next item right away, so that Ann can read it while the tool applies the suggestion on GitHub. When the apply finishes, the list marks the item as applied.

Ann is done with the **Needs triage** group when every item in it is applied or [needs team input](#ask-the-team).

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

Ann cannot triage an item in a couple of minutes, or the suggestion says that the triage bot could not decide. Ann adds `status: needs-team-input` to the labels, leaves out what the team should decide, writes a note for the team in the reply, and clicks **Apply**. While `status: needs-team-input` is checked, "Requires team input. Note for the discussion:" shows above the reply, and the tool posts it as the reply's heading. The tool adds the label, posts the reply, and adds the item to the **Needs team input** group. The item also stays in its own group, with a team icon.

### Triage with the team

Ann goes through the **Needs team input** group with other team members. For each item, the details show Ann's comment for the team below the triage bot's suggestion. Then:

1. If they can triage it in a couple of minutes, Ann adjusts the suggestion and clicks **Apply**.
2. Otherwise, they pick an expert in the area. The triage bot suggests one from the commit history of the affected area (see [Suggested assignees](triage_bot.blueprint.md#suggested-assignees)). Ann adds `status: assigned-for-triage` to the labels, adds the expert to the assignees, and clicks **Apply**.

In both cases, Ann also checks `status: needs-team-input` in the labels to remove.

### Close a duplicate

The suggestion is to close the issue as a duplicate of #1100. Ann opens #1100 from the related issues, confirms that it reports the same problem, and clicks **Apply**. The tool posts the reply and closes the issue as a duplicate of #1100.

### Triage an issue and its PR

An issue has a PR that fixes it, and both need triage. When Ann selects the issue, the details show a tab for each. Ann adjusts both suggestions and clicks **Apply** once, which applies both.

### Recover from a failed apply

Ann clicks **Apply**, and GitHub refuses to assign one of the assignees. By then the tool has selected the next item, so the list marks the failed item with an error icon. Ann selects it again. The **Edit** tab shows which changes the tool made and which failed, and the **Log** tab keeps them after the next try. Ann removes the assignee and clicks **Apply** again. The tool does not post the reply a second time.

### Refresh the queue

While Ann works, a new issue arrives, and a team member triages another item on GitHub. Ann clicks **Refresh** in the header. The list shows the new issue and drops the item that no longer has `status: needs-triage`. If the selected item changed on GitHub, the details show its current state, so Ann doesn't apply a suggestion to an old view of the item.

### Hide the triaged items

Ann has applied suggestions to a dozen items, and the list is long. Ann clicks **Hide triaged** in the header. Each group drops the items that Ann applied a suggestion to and that no longer belong to it as they are now. An issue that Ann sent to the team leaves **Needs triage** and stays in **Needs team input**. An item whose apply failed stays, so that Ann can try again. The next refresh sets the groups again. **Hide triaged** is disabled when no item would leave the list.

### Create a report

At the end of the triage week, Ann wants to report the week's triage to the team.

1. Ann clicks **Create report** in the hamburger menu.
2. A dialog shows a prompt that asks an agent for the [triage report](triage_bot.blueprint.md#triage-report) of the session: from the day the tool started to today, with the dates written out, as in "Create the triage report for 2026-11-06 to 2026-11-12". The prompt tells the agent to use the [a2ui-triage-bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) skill from the `main` branch. The dialog also says that after creating the report, the agent asks Ann whether to [unsubscribe Ann from the items in it, post it to the go/a2ui-core-working-group chat space, and add it to go/a2ui-triage-log](triage_bot.blueprint.md#after-the-report).
3. Ann clicks **Copy and close**, and pastes the prompt to an agent in the a2ui checkout. **Close** closes the dialog without copying.
