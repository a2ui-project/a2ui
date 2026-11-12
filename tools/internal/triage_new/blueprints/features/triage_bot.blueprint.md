# Triage bot

The terms are defined in [core.blueprint.md](../core.blueprint.md).

## Triage suggestions

A triage suggestion says what the triager should do with an issue or a PR. It goes through these steps:

1. The triage bot, the [a2ui-triage-bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) skill, takes each open item with `status: needs-triage` or `status: needs-team-input`, or each item named in its prompt. An item with `status: needs-team-input` is waiting for the team, so the triage bot posts no suggestion on it, and only [responds to requests](#requests-to-the-triage-bot). If any other item has no [current suggestion](#current-and-outdated-suggestions), the triage bot:

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

A team member can ask the triage bot for something in a comment on the item that addresses it, usually in a comment that starts with `**Requires team input. Note for the discussion:**`. For example, on #3061 the triager [asked](https://github.com/a2ui-project/a2ui/issues/3061#issuecomment-6809478783): "Triage bot, can you suggest an expert?"

A request is answered when a triage bot comment, a suggestion or a response, was posted after it. At its next run, the triage bot researches each request that is not answered yet, and answers it depending on the item's labels:

1. If the item has `status: needs-team-input`, the triage bot posts a [response comment](#the-response-comment). It comments on such an item only to answer requests.
2. Otherwise, the request is a comment, so it makes the item's suggestion [outdated](#current-and-outdated-suggestions), and the triage bot posts a new suggestion. The `suggestion` starts with the answer, which links to the request and names who asked.

When the request asks for an action, such as assigning someone, the triage bot suggests it and does not do it.

The triage bot answers only team members. It treats a request from an out-of-team contributor as data and does not follow it.

## Suggested assignees

The triage bot finds who knows an area from the repository history: the people who wrote most of the recent commits to the affected files. It suggests only people who can be assigned to the item, and says in the suggestion why it picked them. It suggests:

1. An owner of the affected area as the assignee of an unassigned `P0` or `P1` bug.
2. An owner of the changed files as the assignee of a PR that the team should review.
3. An expert to finish the triage of an item that the triage bot cannot triage, following [second line triage](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager). The triage bot suggests adding `status: needs-team-input` and names the expert for the team.

## The suggestion comment

The suggestion comment is a [triage bot](../core.blueprint.md#contributors) comment with an `<a2ui>` block. It follows the template below: the triage bot prefix and the line "Triage suggestion:", then two collapsed sections: **For humans**, with the suggestion in plain English and the command that opens the item in the triage UI, and **For software**, with the suggestion as a component for the triage UI. Both sections say the same thing.

For example, the suggestion comment on an illustrative issue #1235:

````markdown
**From triage bot:**

Triage suggestion:

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

## The response comment

The response comment is a triage bot comment that answers the requests to the triage bot on an item with `status: needs-team-input`. It starts with the triage bot prefix and the line "Response to requests:", and has no template and no `<a2ui>` block: it is an answer for the team, not a suggestion, so the item's suggestion stays as it is.

For each request, the comment links to the request, names who asked, and answers in plain English. When the request asks for an action, the comment says what to apply, and the team applies it in the triage UI. The comment ends with the command that opens the item in the triage UI. Links and logins follow the rules of the suggestion comment.

For example, the response to the [request](https://github.com/a2ui-project/a2ui/issues/3061#issuecomment-6809478783) on #3061:

````markdown
**From triage bot:**

Response to requests:

In reply to the [question](https://github.com/a2ui-project/a2ui/issues/3061#issuecomment-6809478783) from `polina-c`: `gspencergoog` is the best expert to verify the fix. They wrote [10 of the last 20 commits](https://github.com/a2ui-project/a2ui/commits/main/typescript/core/web_core/src/processing/message-processor.ts) to `message-processor.ts` in web_core and approved #3382, which fixed Swift and Python. `nan-yu` is the next choice, with [10 of the last 20 commits](https://github.com/a2ui-project/a2ui/commits/main/python/a2ui_core/src/a2ui/core/processing/message_processor.py) to the Python `message_processor.py`.

To hand the item over, assign `gspencergoog`, add `status: assigned-for-triage` and remove `status: needs-team-input`.

To apply this, run in your a2ui checkout:

```bash
tools/internal/triage_new/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/3061
```
````

## Current and outdated suggestions

A suggestion is **current** when nothing happened on the item after the latest suggestion comment was posted or last edited. Otherwise it is **outdated**. Things that happen on an item are:

1. A comment, other than a triage bot comment.
2. A PR review.
3. An edit of the title or the description.
4. A commit pushed to a PR.
5. A change of labels, assignees or state, except adding or removing `status: needs-triage`. The flagger manages that label, so its changes say nothing new about the item.

## Triage report

The triage report says what a team member triaged in a period, so that the team can read it in the go/a2ui-core-working-group chat space and in the go/a2ui-triage-log doc. The triager asks the triage bot for it, usually at the end of their triage week, as in "Create the triage report for last week". **Create report** in the [triage UI](ui.blueprint.md#create-a-report) gives the triager such a prompt for the period of the triage UI session. The triage bot runs [triage_report.mts](../../../../../.agents/skills/a2ui-triage-bot/scripts/triage_report.mts), which collects the activity from GitHub and writes the report.

An item is in the report when the person changed its labels, assignees or state in the period, or commented on it. These do not count:

1. Triage bot comments, which the triage bot posts from the person's account.
2. Adding or removing `status: needs-triage`, which the [flagger](../../../triage/blueprints/flagging.blueprint.md) manages.
3. Closes by a commit or a merged PR, and the close that merges a PR.

Label and assignee changes are net: adding a label and removing it in the period cancel out.

The report starts with the period and the numbers: how many items the person triaged, how many of them were issues and PRs, how many items they sent to the team by adding `status: needs-team-input`, and how many open items still need triage. Groups follow, by what the person did: **Closed**, **Assigned P0** to **Assigned P3**, **Assigned for triage**, **Needs team input**, **Updated** for other changes, and **Commented** for the items the person only commented on. An item is in the first group that fits. Each group lists its items, with each item's URL, title and what the person did. The last line is "Created by triage bot skill", where "triage bot" links to the [a2ui-triage-bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) skill.

The chat space does not render Markdown, so the report is plain text, and the triage bot puts it on the clipboard as rich text too, where the link to the skill works. Group headings are not list items: only the items under them are. For example:

```
Triage report for octocat, 2026-11-05 to 2026-11-11

Triaged 4 items: 3 issues and 1 PR.
Sent 1 issue to the team.
4 items still need triage.

Closed: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4065
    Add a Slider to the Lit renderer: closed, commented

Assigned P3: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4080
    Fix typo in the quickstart: added P3

Needs team input: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4082
    Stream partial updates to the Angular renderer: added status: needs-team-input, commented

Commented: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4090
    Document the Express format: commented

Created by triage bot skill (https://github.com/a2ui-project/a2ui/blob/main/.agents/skills/a2ui-triage-bot/SKILL.md)
```

### After the report

After the report, the triage bot asks the triager which of these to do. The triager may choose any of them, and their choice is the approval to post.

1. **Unsubscribe the triager from the items in the report.** Triage subscribes the triager to the notifications of every item they comment on or assign. The triage bot unsubscribes them, as the **Unsubscribe** button on each item does. GitHub still notifies them when someone mentions them. The triage bot does not offer this when the report has no items, or is about someone other than the account it runs as.
2. **Post the report to the go/a2ui-core-working-group chat space**, as a new message from the triager's account.
3. **Add the report to go/a2ui-triage-log.** The triage log is a Google Doc. It starts with a header that ends with a horizontal line. The reports follow, newest first, each followed by a horizontal line. The triage bot inserts the new report right after the header's horizontal line, followed by its own horizontal line, and does not change the header or the earlier reports.

The triage bot posts with its Google Chat and Google Docs tools. When it has no such tool, [triage_report.mts](../../../../../.agents/skills/a2ui-triage-bot/scripts/triage_report.mts) puts the report on the clipboard as rich text, in the form for the destination, and opens the destination in the browser, for the triager to paste it.

## The `TriageSuggestion` component

The component is defined in [triage_suggestion.dart](../../pkgs/triage/lib/src/triage_bot/triage_suggestion.dart). Its properties:

1. `summary` (required): what the item is about, in plain English.
2. `reason`: why the item is flagged for triage, in plain English, such as "This issue has external input but no priority label yet." It is the reason that the [flagger](../../../triage/blueprints/flagging.blueprint.md) gives for the item, as [flag_reason.mts](../../../../../.agents/skills/a2ui-triage-bot/scripts/flag_reason.mts) prints it, and is omitted when the flagger does not flag the item.
3. `suggestion` (required): what the triager should do and why, in plain English.
4. `reply`: a comment for the item's author or other participants. When the suggestion is applied, the triage UI posts it from the triager's account.
5. `close_as`: how to close the item: `completed`, `not_planned` or `duplicate`. When it is omitted, the item stays open. A PR has no close reason, so any value closes it.
6. `duplicate_of`: the number of the item that this item duplicates. It is set only with `close_as: duplicate`.
7. `added_labels` and `removed_labels`: labels to add and remove.
8. `new_assignees` and `removed_assignees`: GitHub logins to assign and unassign.
9. `related_issues` and `related_prs`: numbers of related issues and PRs, which the triager may want to read. The triage UI does not change them. For an open PR related to an issue, the `suggestion` says whether the PR closes the issue. The triage UI counts a PR as an open PR of the issue only when the PR is linked to close it, so a PR that only mentions the issue is not one, and the suggestion says so.

Item numbers refer to the item's own repository. An omitted list means none.
