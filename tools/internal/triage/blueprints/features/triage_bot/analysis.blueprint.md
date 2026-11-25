# Triage analyses

The terms are defined in [core.blueprint.md](../../core.blueprint.md). The [triage analyzer](../../core.blueprint.md#triage-jobs) posts the analyses.

A triage analysis says what the triager should do with an issue or a PR. It goes through these steps:

1. The triage bot, the [a2ui-triage-bot](../../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) skill, takes each open item with `status: needs-triage`, or each item named in its prompt. An item with `status: needs-team-input` waits for the team, so it gets no analysis, only [response comments](response.blueprint.md). If the item has no [current analysis](#current-and-outdated-analyses), the triage bot:

   1. Researches the item and decides what the triager should do.
   2. If the item has no analysis, or the activity after it changes it significantly, writes the decision as a [`TriageAnalysis`](#the-triageanalysis-component) A2UI component, and posts it in a new [analysis comment](#the-analysis-comment).
   3. Otherwise, [updates the latest analysis](#updating-an-analysis).

2. The [triage UI](../ui.blueprint.md):

   1. Parses the analysis from the comment.
   2. Shows it to the triager.
   3. Lets the triager change it.
   4. Applies its suggestion to the item when the triager clicks **Apply**.

The triage bot only comments. It never changes labels, assignees or the state of an item: that is the triager's decision.

## Current and outdated analyses

An analysis is **current** when nothing happened on the item after the latest analysis comment was posted or last edited. Otherwise it is **outdated**. Things that happen on an item are:

1. A comment, other than a triage bot comment.
2. A PR review, or an inline comment in one.
3. An edit of the title or the description.
4. A commit pushed to a PR, a force push to it, or marking it ready for review.
5. A change of labels, assignees or state, except adding or removing `status: needs-triage`. The flagger manages that label, so its changes say nothing new about the item.

A mention of the item in another item does not count: the triage bot's analyses of related items make many of them.

## The analysis comment

The analysis comment is a [triage bot](../../core.blueprint.md#contributors) comment with an `<a2ui>` block. It follows the template below: the line `**From triage bot, analysis:**`, two collapsed sections, and a disclaimer. **For humans** has the analysis in plain English and the command that opens the item in the triage UI, and **For software** has the analysis as a component for the triage UI. Both sections say the same thing.

For example, the analysis comment on an illustrative issue #1235:

````markdown
**From triage bot, analysis:**

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

- P1: any agent that streams an empty `Row` crashes the surface, and there is no workaround.
- `octocat` made [most of the recent changes](https://github.com/a2ui-project/a2ui/commits/main/dart/a2ui_flutter) to `dart/a2ui_flutter`.
- [#1234](https://github.com/a2ui-project/a2ui/issues/1234) reports the same crash for `Column` and probably has the same cause.

1. Add labels: `status: assigned-for-triage`, `type: bug`, `P1`, `component: flutter adapter`, `status: first-line-handled`
2. Assign: `octocat`
3. Related items: #1234

Reply:

> **From triage:**
>
> Thanks for the report and the payload that reproduces it. We confirmed the crash and plan to fix it soon. [#1234](https://github.com/a2ui-project/a2ui/issues/1234) reports the same crash for `Column`.

To adjust the analysis and apply its suggestion, open it in the [hosted triage UI](http://go/a2ui-triage-ui?item=https://github.com/a2ui-project/a2ui/issues/1235), or run in your a2ui checkout:

```bash
tools/internal/triage/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/1235
```

</details>

<details>
<summary>For software</summary>

```
<a2ui>
root = TriageAnalysis(
  tldr="""Case: this issue highlights a problem.
Suggestion: set P1 and assign for triage to an expert.""",
  summary="""The issue highlights the problem: Flutter renderer throws an exception when a `Row` has an empty `children` list. [Per blueprint](the_blueprint.md), it should not.""",
  reason="This issue has external input but no priority label yet.",
  suggestion="""- P1: any agent that streams an empty `Row` crashes the surface, and there is no workaround.
- `octocat` made [most of the recent changes](https://github.com/a2ui-project/a2ui/commits/main/dart/a2ui_flutter) to `dart/a2ui_flutter`.
- [#1234](https://github.com/a2ui-project/a2ui/issues/1234) reports the same crash for `Column` and probably has the same cause.""",
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

This analysis is auto-created to help humans to triage this item. Please, do not treat it as a team decision.
````

The parts of the comment, in order:

1. The line `**From triage bot, analysis:**`.
2. The **For humans** section, collapsed:
   1. The `tldr`, under **TL;DR**. The part is left out when there is no TL;DR.
   2. The `summary`, the `targeting_prs`, the `targeted_issues`, the `reason` and the `suggestion`, as paragraphs under **Summary**, **Targeting PRs**, **Targeted issues**, **Why flagged for triage** and **Suggestion**. **Targeting PRs** and **Targeted issues** have the URL of each item on its own line. The **Targeting PRs**, **Targeted issues** and **Why flagged for triage** paragraphs are left out when their property has no value.
   3. The other properties that have values, as a numbered list: **Close as**, **Add labels**, **Remove labels**, **Assign**, **Unassign**, **Related items**. An example of **Close as** is "Close as: duplicate of #1100".
   4. The `reply`, quoted, under **Reply**, after the heading that the triage UI posts it under (see `reply` below).
   5. The link to the item in the hosted triage UI, and the command that opens it in the triage UI on macOS.
3. The **For software** section, collapsed: the component.
4. The line that [Updating an analysis](#updating-an-analysis) adds, if the triage bot updated the analysis.
5. The disclaimer: "This analysis is auto-created to help humans to triage this item. Please, do not treat it as a team decision."

The component is written in [A2UI Express](../../../../../../specification/inference_formats/express/Express.g4), as one `root = TriageAnalysis(...)` statement. The code fence makes GitHub show it as written, and the triage UI reads the text between `<a2ui>` and `</a2ui>`. The UI takes the analysis as invalid unless the block creates one surface whose root is the component: assigning it to another name than `root` creates no surface.

The link opens the hosted triage UI, which the [server](../../../pkgs/server/README.md) serves to Googlers, with the item: go/a2ui-triage-ui points at the hosted UI, and passes on the `item` parameter, the item's URL, for example `http://go/a2ui-triage-ui?item=https://github.com/a2ui-project/a2ui/issues/123`. After the triager signs in to GitHub, the UI opens the item.

The [triage_ui.sh](../../../triage_ui.sh) command takes the item's URL, for example `https://github.com/a2ui-project/a2ui/issues/123`. GitHub shows a copy button on the code block, so the triager copies the command and pastes it into a terminal. The script:

1. Sends the URL to the triage UI if the app is running. The app listens on `127.0.0.1:47123`, accepts `POST /open` with the URL in the `item` form field, and accepts only URLs of issues and PRs in `a2ui-project/a2ui` and `flutter/genui`. It refuses requests that a browser sends, which carry `Origin` or `Sec-Fetch-Site`, and bodies over 4 KiB.
2. Otherwise starts the app on macOS with `flutter run`, passing the URL as the app's argument.

The `tldr`, the `summary`, the `suggestion` and the `reply` link every artifact they mention, so that the triager can check it in one click: files, folders, lines of code, issues, PRs, commits, workflow runs, docs pages and specifications. The link is on the words that name the artifact: in "The `genui` package README links to `./DESIGN.md`", "README" links to the README file, not to its repository. When the text says what someone said, asked, decided or did, the words link to where they did it, such as the comment: in "`jacobsimionato` declined the Go SDK in #1279 and asked `nan-yu` to confirm", "declined" and "asked" link to `jacobsimionato`'s comment. Links to files point to a commit SHA, not to a branch, so that they keep showing what the triage bot read. When the text is about specific lines, such as a broken link or the code that causes a bug, it links to those lines with a permalink, the commit SHA and a line anchor such as `#L10-L20`, not to the whole file. Issues and PRs are Markdown links with the number as their text, such as `[#123](https://github.com/a2ui-project/a2ui/pull/123)`, or `[owner/repo#123](https://github.com/owner/repo/issues/123)` in another repository: GitHub turns a bare `#123` into a link, but the triage UI does not.

The comment names people by their GitHub login in backticks, without `@`. An analysis is not a decision, so it does not notify the people it names.

An item can have several analysis comments. When the analysis is outdated and the activity after it changes it significantly, the triage bot posts a new one and leaves the earlier ones as they are, so that people can follow the triage as a conversation: each analysis, the comments and requests that made it outdated, and the next analysis that answers them. The latest analysis comment is the item's analysis.

## Updating an analysis

The activity after an analysis changes it significantly when it brings a request to the triage bot, or when the triage bot would change the case, the suggested action, or a property such as the labels, the assignees, the close reason or the reply.

Otherwise, the triage bot does not post a new analysis. It edits the latest analysis comment instead, and adds this line above the disclaimer, with a link to each comment and review it took into account, and other activity in a few words:

```markdown
This analysis does not change after taking the later submitted comments into account: [comment](https://github.com/a2ui-project/a2ui/issues/1235#issuecomment-1) from `octocat`.
```

A later update replaces the line, and lists everything since the analysis was posted. The edit makes the analysis current.

## The `TriageAnalysis` component

The component is defined in [triage_analysis.dart](../../../pkgs/shared/lib/src/triage_bot/triage_analysis.dart). Its properties:

1. `tldr`: the case and the suggestion in a few words each, as two lines: "Case: ..." and "Suggestion: ...", such as "Case: this issue highlights a problem." and "Suggestion: set P1 and assign for triage to an expert." It is the short form of the `summary` and the `suggestion`.
2. `summary` (required): what the item is about, in plain English.
3. `reason`: why the item is flagged for triage, in plain English, such as "This issue has external input but no priority label yet." It is the reason that the [flagger](../flagger.blueprint.md) gives for the item, as [flag_reason.dart](../../../pkgs/flagger/bin/flag_reason.dart) prints it, and is omitted when the flagger does not flag the item.
4. `suggestion` (required): why the triager should take the action, in plain English, as 2 to 4 short bullets: the evidence, and anything to watch out for. It does not repeat the action, which `tldr` has, or the labels, assignees and close reason, which the triage UI shows from the properties.
5. `reply`: a short comment for the item's author or other participants, such as "Assigning this PR to `xyz`, because they already started reviewing it." The triage bot always writes one: it says at least what the triager does and why. It has no heading: when the suggestion is applied, the triage UI posts it from the triager's account under the line `**From triage:**`, or under the note for the team, `**Requires team input. Note for the discussion:**`, when `added_labels` has `status: needs-team-input`. The UI removes such a heading from the start of a reply that has one, as older analyses do.
6. `close_as`: how to close the item: `completed`, `not_planned` or `duplicate`. When it is omitted, the item stays open. A PR has no close reason, so any value closes it, and the triage UI shows any value on a PR as a plain close.
7. `duplicate_of`: the number of the item that this item duplicates. It is set exactly when `close_as` is `duplicate`: the triage UI takes an analysis that breaks this as invalid.
8. `added_labels` and `removed_labels`: labels to add and remove.
9. `new_assignees` and `removed_assignees`: GitHub logins to assign and unassign.
10. `targeting_prs`: numbers of open PRs that target the item, such as PRs that fix it. A PR can target an issue without being linked to close it, so the `suggestion` says whether each PR closes the issue. The triage UI lists the issue under **Issues with open PRs** when it has a PR in `targeting_prs` or a PR linked to close it, and a PR under **PRs with issues** when it has an issue in `targeted_issues` or an issue it is linked to close. See [Items](../ui.blueprint.md#items).
11. `targeted_issues`: numbers of issues that the item targets, such as the issues that a PR fixes.
12. `related_items`: numbers of other issues and PRs that relate to the item, which the triager may want to read.

The triage UI shows `targeting_prs`, `targeted_issues` and `related_items` as links, and does not change them.

Item numbers refer to the item's own repository. An omitted list means none.
