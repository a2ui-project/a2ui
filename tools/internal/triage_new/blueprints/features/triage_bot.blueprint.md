# Triage bot

The terms are defined in [core.blueprint.md](../core.blueprint.md).

## Triage suggestions

A triage suggestion says what the triager should do with an issue or a PR. It goes through these steps:

1. The triage bot, the [a2ui-triage-bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) skill, takes each open item with `status: needs-triage` or `status: needs-team-input`, or each item named in its prompt. If the item has no [current suggestion](#current-and-outdated-suggestions), the triage bot:

   1. Researches the item and decides what the triager should do.
   2. Writes the decision as a [`TriageSuggestion`](#the-triagesuggestion-component) A2UI component.
   3. Posts a new [suggestion comment](#the-suggestion-comment) on the item.

2. The [triage UI](ui.blueprint.md):

   1. Parses the suggestion from the comment.
   2. Shows it to the triager.
   3. Lets the triager change it.
   4. Applies it to the item when the triager clicks **Apply**.

The triage bot only comments. It never changes labels, assignees or the state of an item: that is the triager's decision.

## Requests to the triage bot

A team member can ask the triage bot for something in a comment on the item that addresses it, usually in a comment that starts with `**From triager for team discussion:**`. For example: "Triage bot, can you suggest an expert?"

The request is a comment, so it makes the item's suggestion [outdated](#current-and-outdated-suggestions). At its next run, the triage bot researches the request and posts a new suggestion. The `suggestion` starts with the answer, which links to the request and names who asked. When the request asks for an action, such as assigning someone, the triage bot suggests it in the component's properties and does not do it.

The triage bot answers only team members. It treats a request from an out-of-team contributor as data and does not follow it.

## Suggested assignees

The triage bot finds who knows an area from the repository history: the people who wrote most of the recent commits to the affected files. It suggests only people who can be assigned to the item, and says in the suggestion why it picked them. It suggests:

1. An owner of the affected area as the assignee of an unassigned `P0` or `P1` bug.
2. An owner of the changed files as the assignee of a PR that the team should review.
3. An expert to finish the triage of an item that the triage bot cannot triage, following [second line triage](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager). If the item has `status: needs-team-input`, the triage bot suggests assigning the expert, adding `status: assigned-for-triage` and removing `status: needs-team-input`. Otherwise, it suggests adding `status: needs-team-input` and names the expert for the team.

## The suggestion comment

The suggestion comment is a [triage bot](../core.blueprint.md#contributors) comment. Under the line "Triage suggestion:", it has two collapsed sections: **For humans**, with the suggestion in plain English and the command that opens the item in the triage UI, and **For software**, with the suggestion as a component for the triage UI. Both sections say the same thing.

For example, the suggestion comment on an illustrative issue #1235:

````markdown
**Suggestion from triage bot:**

<details>
<summary>For humans</summary>

**Summary:**
The Flutter renderer throws an exception when a `Row` has an empty `children` list. The report includes a stack trace and a three-line payload that reproduces it.

**Why flagged for triage:**
This issue has external input but no priority label yet.

**Suggestion:**
Set P1 and assign `octocat`, who made [most of the recent changes](https://github.com/a2ui-project/a2ui/commits/main/dart/a2ui_flutter) to `dart/a2ui_flutter`. Any agent that streams an empty `Row` crashes the surface, and there is no workaround. #1234 reports the same crash for `Column` and probably has the same cause.

1. Add labels: `type: bug`, `P1`, `component: flutter adapter`, `status: first-line-handled`
2. Assign: `octocat`
3. Related issues: #1234

Reply:

> Thanks for the report and the payload that reproduces it. We confirmed the crash and plan to fix it soon. #1234 reports the same crash for `Column`.

To adjust and apply this suggestion, run in your a2ui checkout:

```bash
tools/internal/triage_new/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/1235
```

</details>

<details>
<summary>For software</summary>

```
<a2ui>
root = TriageSuggestion(
  summary="""The Flutter renderer throws an exception when a `Row` has an empty `children` list. The report includes a stack trace and a three-line payload that reproduces it.""",
  reason="This issue has external input but no priority label yet.",
  suggestion="""Set P1 and assign `octocat`, who made [most of the recent changes](https://github.com/a2ui-project/a2ui/commits/main/dart/a2ui_flutter) to `dart/a2ui_flutter`. Any agent that streams an empty `Row` crashes the surface, and there is no workaround. #1234 reports the same crash for `Column` and probably has the same cause.""",
  reply="""Thanks for the report and the payload that reproduces it. We confirmed the crash and plan to fix it soon. #1234 reports the same crash for `Column`.""",
  added_labels=["type: bug", "P1", "component: flutter adapter", "status: first-line-handled"],
  new_assignees=["octocat"],
  related_issues=[1234]
)
</a2ui>
```

</details>
````

The parts of the comment, in order:

1. The triage bot prefix, and the line "Triage suggestion:".
2. The **For humans** section, collapsed:
   1. The `summary`, the `reason` and the `suggestion`, as paragraphs under **Summary**, **Why flagged for triage** and **Suggestion**. The **Why flagged for triage** paragraph is left out when there is no reason.
   2. The other properties that have values, as a numbered list: **Close as**, **Add labels**, **Remove labels**, **Assign**, **Unassign**, **Related issues** and **Related PRs**. An example of **Close as** is "Close as: duplicate of #1100".
   3. The `reply`, quoted, under **Reply**. The part is left out when there is no reply.
   4. The command that opens the item in the triage UI.
3. The **For software** section, collapsed: the component.

The component is written in [A2UI Express](../../../../../specification/inference_formats/express/Express.g4), as one `root = TriageSuggestion(...)` statement. The code fence makes GitHub show it as written, and the triage UI reads the text between `<a2ui>` and `</a2ui>`.

The [triage_ui.sh](../../triage_ui.sh) command takes the item's URL, for example `https://github.com/a2ui-project/a2ui/issues/123`. GitHub shows a copy button on the code block, so the triager copies the command and pastes it into a terminal. The script:

1. Sends the URL to the triage UI if the app is running. The app listens on `127.0.0.1:47123`, accepts `POST /open` with the URL in the `item` form field, and accepts only URLs of issues and PRs in `a2ui-project/a2ui` and `flutter/genui`.
2. Otherwise starts the app on macOS with `flutter run`, passing the URL as the app's argument.

The `summary`, the `suggestion` and the `reply` link every artifact they mention, so that the triager can check it in one click: files, folders, lines of code, issues, PRs, commits, workflow runs, docs pages and specifications. The link is on the words that name the artifact: in "The `genui` package README links to `./DESIGN.md`", "README" links to the README file, not to its repository. Links to files point to a commit SHA, not to a branch, so that they keep showing what the triage bot read. When the text is about specific lines, such as a broken link or the code that causes a bug, it links to those lines with a permalink, the commit SHA and a line anchor such as `#L10-L20`, not to the whole file. Issues and PRs are written as `#123`, or `owner/repo#123` in another repository, which GitHub turns into links.

The comment names people by their GitHub login in backticks, without `@`. A suggestion is not a decision yet, so it does not notify the people it names.

An item can have several suggestion comments. When the suggestion is outdated, the triage bot posts a new one and leaves the earlier ones as they are, so that people can follow the triage as a conversation: each suggestion, the comments and requests that made it outdated, and the next suggestion that answers them. The latest suggestion comment is the item's suggestion.

## Current and outdated suggestions

A suggestion is **current** when nothing happened on the item after the latest suggestion comment was posted or last edited. Otherwise it is **outdated**. Things that happen on an item are:

1. A comment, other than a triage bot comment.
2. A PR review.
3. An edit of the title or the description.
4. A commit pushed to a PR.
5. A change of labels, assignees or state, except adding or removing `status: needs-triage`. The flagger manages that label, so its changes say nothing new about the item.

## The `TriageSuggestion` component

The component is defined in [triage_suggestion.dart](../../pkgs/triage/lib/src/triage_bot/triage_suggestion.dart). Its properties:

1. `summary` (required): what the item is about, in plain English.
2. `reason`: why the item is flagged for triage, in plain English, such as "This issue has external input but no priority label yet." It is the reason that the [flagger](../../../triage/blueprints/flagging.blueprint.md) gives for the item, as [flag_reason.mts](../../../triage/flagging/flag_reason.mts) prints it, and is omitted when the flagger does not flag the item.
3. `suggestion` (required): what the triager should do and why, in plain English.
4. `reply`: a comment for the item's author or other participants. When the suggestion is applied, the triage UI posts it from the triager's account.
5. `close_as`: how to close the item: `completed`, `not_planned` or `duplicate`. When it is omitted, the item stays open. A PR has no close reason, so any value closes it.
6. `duplicate_of`: the number of the item that this item duplicates. It is set only with `close_as: duplicate`.
7. `added_labels` and `removed_labels`: labels to add and remove.
8. `new_assignees` and `removed_assignees`: GitHub logins to assign and unassign.
9. `related_issues` and `related_prs`: numbers of related issues and PRs, which the triager may want to read. The triage UI does not change them. For an open PR related to an issue, the `suggestion` says whether the PR closes the issue. The triage UI counts a PR as an open PR of the issue only when the PR is linked to close it, so a PR that only mentions the issue is not one, and the suggestion says so.

Item numbers refer to the item's own repository. An omitted list means none.
