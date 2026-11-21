# Triage suggestions

The terms are defined in [core.blueprint.md](../../core.blueprint.md). The [triage advisor](../../core.blueprint.md#triage-jobs) posts the suggestions.

A triage suggestion says what the triager should do with an issue or a PR. It goes through these steps:

1. The triage bot, the [a2ui-triage-bot](../../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) skill, takes each open item with `status: needs-triage` or `status: needs-team-input`, or each item named in its prompt. If the item has no [current suggestion](#current-and-outdated-suggestions), the triage bot:

   1. Researches the item and decides what the triager should do.
   2. Writes the decision as a [`TriageSuggestion`](#the-triagesuggestion-component) A2UI component.
   3. Posts the drafted [suggestion comment](#the-suggestion-comment) on the item.

2. The [triage UI](../ui.blueprint.md):

   1. Parses the suggestion from the comment.
   2. Shows it to the triager.
   3. Lets the triager change it.
   4. Applies it to the item when the triager clicks **Apply**.

The triage bot only comments. It never changes labels, assignees or the state of an item: that is the triager's decision.

## Current and outdated suggestions

A suggestion is **current** when nothing happened on the item after the latest suggestion comment was posted or last edited. Otherwise it is **outdated**. Things that happen on an item are:

1. A comment, other than a triage bot comment.
2. A PR review.
3. An edit of the title or the description.
4. A commit pushed to a PR.
5. A change of labels, assignees or state, except adding or removing `status: needs-triage`. The flagger manages that label, so its changes say nothing new about the item.

## The suggestion comment

The suggestion comment is a [triage bot](../../core.blueprint.md#contributors) comment with an `<a2ui>` block. It follows the template below: the line `**From triage bot, suggestion:**`, then two collapsed sections: **For humans**, with the suggestion in plain English and the command that opens the item in the triage UI, and **For software**, with the suggestion as a component for the triage UI. Both sections say the same thing.

For example, the suggestion comment on an illustrative issue #1235:

````markdown
**From triage bot, suggestion:**

<details>
<summary>For humans</summary>

**TL;DR**
Case: this issue highlights a problem.
Suggestion: set P1 and assign for triage to an expert.

**Summary:**
The issue highlights the problem: Flutter renderer throws an exception when a `Row` has an empty `children` list. [Per blueprint](response.blueprint.md), it should not.

**Targeting PRs:**
https://github.com/a2ui-project/a2ui/pull/3001

**Targeted issues:**
https://github.com/a2ui-project/a2ui/issues/3002

**Why flagged for triage:**
This issue has external input but no priority label yet.

**Suggestion:**
Set P1 and assign for triage to `octocat`, who made [most of the recent changes](https://github.com/a2ui-project/a2ui/commits/main/dart/a2ui_flutter) to `dart/a2ui_flutter`. Any agent that streams an empty `Row` crashes the surface, and there is no workaround. [#1234](https://github.com/a2ui-project/a2ui/issues/1234) reports the same crash for `Column` and probably has the same cause.

1. Add labels: `status: assigned-for-triage`, `type: bug`, `P1`, `component: flutter adapter`, `status: first-line-handled`
2. Assign: `octocat`
3. Related items: #1234

Reply:

> Thanks for the report and the payload that reproduces it. We confirmed the crash and plan to fix it soon. [#1234](https://github.com/a2ui-project/a2ui/issues/1234) reports the same crash for `Column`.

To adjust and apply this suggestion, run in your a2ui checkout:

```bash
tools/internal/triage/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/1235
```

</details>

<details>
<summary>For software</summary>

```
<a2ui>
root = TriageSuggestion(
  tldr="""Case: this issue highlights a problem.
Suggestion: set P1 and assign for triage to an expert.""",
  summary="""The issue highlights the problem: Flutter renderer throws an exception when a `Row` has an empty `children` list. [Per blueprint](the_blueprint.md), it should not.""",
  reason="This issue has external input but no priority label yet.",
  suggestion="""Set P1 and assign for triage to `octocat`, who made [most of the recent changes](https://github.com/a2ui-project/a2ui/commits/main/dart/a2ui_flutter) to `dart/a2ui_flutter`. Any agent that streams an empty `Row` crashes the surface, and there is no workaround. [#1234](https://github.com/a2ui-project/a2ui/issues/1234) reports the same crash for `Column` and probably has the same cause.""",
  reply="""Thanks for the report and the payload that reproduces it. We confirmed the crash and plan to fix it soon. [#1234](https://github.com/a2ui-project/a2ui/issues/1234) reports the same crash for `Column`.""",
  added_labels=["status: assigned-for-triage", "type: bug", "P1", "component: flutter adapter", "status: first-line-handled"],
  new_assignees=["octocat"],
  targeting_prs=[3001],
  targeted_issues=[3002],
  related_items=[1234]
)
</a2ui>
```

</details>
````

The parts of the comment, in order:

1. The line `**From triage bot, suggestion:**`.
2. The **For humans** section, collapsed:
   1. The `tldr`, under **TL;DR**. The part is left out when there is no TL;DR.
   2. The `summary`, the `targeting_prs`, the `targeted_issues`, the `reason` and the `suggestion`, as paragraphs under **Summary**, **Targeting PRs**, **Targeted issues**, **Why flagged for triage** and **Suggestion**. **Targeting PRs** and **Targeted issues** have the URL of each item on its own line. The **Targeting PRs**, **Targeted issues** and **Why flagged for triage** paragraphs are left out when their property has no value.
   3. The other properties that have values, as a numbered list: **Close as**, **Add labels**, **Remove labels**, **Assign**, **Unassign**, **Related items**. An example of **Close as** is "Close as: duplicate of #1100".
   4. The `reply`, quoted, under **Reply**.
   5. The command that opens the item in the triage UI.
3. The **For software** section, collapsed: the component.

The component is written in [A2UI Express](../../../../../../specification/inference_formats/express/Express.g4), as one `root = TriageSuggestion(...)` statement. The code fence makes GitHub show it as written, and the triage UI reads the text between `<a2ui>` and `</a2ui>`.

The [triage_ui.sh](../../../triage_ui.sh) command takes the item's URL, for example `https://github.com/a2ui-project/a2ui/issues/123`. GitHub shows a copy button on the code block, so the triager copies the command and pastes it into a terminal. The script:

1. Sends the URL to the triage UI if the app is running. The app listens on `127.0.0.1:47123`, accepts `POST /open` with the URL in the `item` form field, and accepts only URLs of issues and PRs in `a2ui-project/a2ui` and `flutter/genui`.
2. Otherwise starts the app on macOS with `flutter run`, passing the URL as the app's argument.

The `tldr`, the `summary`, the `suggestion` and the `reply` link every artifact they mention, so that the triager can check it in one click: files, folders, lines of code, issues, PRs, commits, workflow runs, docs pages and specifications. The link is on the words that name the artifact: in "The `genui` package README links to `./DESIGN.md`", "README" links to the README file, not to its repository. When the text says what someone said, asked, decided or did, the words link to where they did it, such as the comment: in "`jacobsimionato` declined the Go SDK in #1279 and asked `nan-yu` to confirm", "declined" and "asked" link to `jacobsimionato`'s comment. Links to files point to a commit SHA, not to a branch, so that they keep showing what the triage bot read. When the text is about specific lines, such as a broken link or the code that causes a bug, it links to those lines with a permalink, the commit SHA and a line anchor such as `#L10-L20`, not to the whole file. Issues and PRs are Markdown links with the number as their text, such as `[#123](https://github.com/a2ui-project/a2ui/pull/123)`, or `[owner/repo#123](https://github.com/owner/repo/issues/123)` in another repository: GitHub turns a bare `#123` into a link, but the triage UI does not.

The comment names people by their GitHub login in backticks, without `@`. A suggestion is not a decision yet, so it does not notify the people it names.

An item can have several suggestion comments. When the suggestion is outdated, the triage bot posts a new one and leaves the earlier ones as they are, so that people can follow the triage as a conversation: each suggestion, the comments and requests that made it outdated, and the next suggestion that answers them. The latest suggestion comment is the item's suggestion.

## The `TriageSuggestion` component

The component is defined in [triage_suggestion.dart](../../../pkgs/shared/lib/src/triage_bot/triage_suggestion.dart). Its properties:

1. `tldr`: the case and the suggestion in a few words each, as two lines: "Case: ..." and "Suggestion: ...", such as "Case: this issue highlights a problem." and "Suggestion: set P1 and assign for triage to an expert." It is the short form of the `summary` and the `suggestion`.
2. `summary` (required): what the item is about, in plain English.
3. `reason`: why the item is flagged for triage, in plain English, such as "This issue has external input but no priority label yet." It is the reason that the [flagger](../flagger.blueprint.md) gives for the item, as [flag_reason.dart](../../../pkgs/flagger/bin/flag_reason.dart) prints it, and is omitted when the flagger does not flag the item.
4. `suggestion` (required): what the triager should do and why, in plain English.
5. `reply`: a short comment for the item's author or other participants, such as "Assigning this PR to `xyz`, because they already started reviewing it." The triage bot always writes one: it says at least what the triager does and why. When the suggestion is applied, the triage UI posts it from the triager's account.
6. `close_as`: how to close the item: `completed`, `not_planned` or `duplicate`. When it is omitted, the item stays open. A PR has no close reason, so any value closes it.
7. `duplicate_of`: the number of the item that this item duplicates. It is set only with `close_as: duplicate`.
8. `added_labels` and `removed_labels`: labels to add and remove.
9. `new_assignees` and `removed_assignees`: GitHub logins to assign and unassign.
10. `targeting_prs`: numbers of open PRs that target the item, such as PRs that fix it. A PR can target an issue without being linked to close it, so the `suggestion` says whether each PR closes the issue. The triage UI lists the issue under **Issues with open PRs** when it has a PR in `targeting_prs` or a PR linked to close it, and a PR under **PRs with issues** when it has an issue in `targeted_issues` or an issue it is linked to close. See [Items](../ui.blueprint.md#items).
11. `targeted_issues`: numbers of issues that the item targets, such as the issues that a PR fixes.
12. `related_items`: numbers of other issues and PRs that relate to the item, which the triager may want to read.

The triage UI shows `targeting_prs`, `targeted_issues` and `related_items` as links, and does not change them.

Item numbers refer to the item's own repository. An omitted list means none.
