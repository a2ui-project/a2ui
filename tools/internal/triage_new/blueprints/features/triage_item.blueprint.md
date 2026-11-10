# Triage an item

The terms are defined in [core.blueprint.md](../core.blueprint.md).

## Triage suggestions

A triage suggestion says what the triager should do with an issue or a PR. It goes through these steps:

1. The advisor, the [a2ui-triage-advisor](../../../../../.agents/skills/a2ui-triage-advisor/SKILL.md) skill, takes each open item with `status: needs-triage`, or each item named in its prompt. If the item has no [current suggestion](#current-and-outdated-suggestions), the advisor:

   1. Researches the item and decides what the triager should do.
   2. Writes the decision as a [`TriageSuggestion`](#the-triagesuggestion-component) A2UI component.
   3. Posts the [suggestion comment](#the-suggestion-comment) on the item, or updates the item's existing suggestion comment.

2. The [triage UI](ui.blueprint.md):

   1. Parses the suggestion from the comment.
   2. Shows it to the triager.
   3. Lets the triager change it.
   4. Applies it to the item when the triager clicks **Apply**.

The advisor only comments. It never changes labels, assignees or the state of an item: that is the triager's decision.

## The suggestion comment

The suggestion comment is a [triage bot](../core.blueprint.md#contributors) comment. It has a plain English part for people, a command that opens the item in the triage UI, and a part for the triage UI, collapsed under **Details**. The plain English part and the part for the triage UI say the same thing.

For example, the suggestion comment on an illustrative issue #1235:

````markdown
**From triage bot:**

## Triage suggestion

The Flutter renderer throws an exception when a `Row` has an empty `children` list. The report includes a stack trace and a three-line payload that reproduces it.

Set P1 and assign `octocat`, who made most of the recent changes to `dart/a2ui_flutter`. Any agent that streams an empty `Row` crashes the surface, and there is no workaround. #1234 reports the same crash for `Column` and probably has the same cause.

1. Add labels: `type: bug`, `P1`, `component: flutter adapter`, `status: first-line-handled`
2. Assign: `octocat`
3. Related issues: #1234

Reply:

> Thanks for the report and the payload that reproduces it. We confirmed the crash and plan to fix it soon. #1234 reports the same crash for `Column`.

To adjust and apply this suggestion, run in your a2ui checkout:

```bash
tools/internal/triage/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/1235
```

<details>
<summary>Details</summary>

```
<a2ui>
root = TriageSuggestion(
  summary="""The Flutter renderer throws an exception when a `Row` has an empty `children` list. The report includes a stack trace and a three-line payload that reproduces it.""",
  suggestion="""Set P1 and assign `octocat`, who made most of the recent changes to `dart/a2ui_flutter`. Any agent that streams an empty `Row` crashes the surface, and there is no workaround. #1234 reports the same crash for `Column` and probably has the same cause.""",
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

1. The `summary` and the `suggestion`, as paragraphs.
2. The other properties that have values, as a numbered list: **Close as**, **Add labels**, **Remove labels**, **Assign**, **Unassign**, **Related issues** and **Related PRs**. An example of **Close as** is "Close as: duplicate of #1100".
3. The `reply`, quoted, under **Reply**. The section is left out when there is no reply.
4. The command that opens the item in the triage UI.
5. The component, under **Details**.

The component is written in [A2UI Express](../../../../../specification/inference_formats/express/Express.g4), as one `root = TriageSuggestion(...)` statement. The code fence makes GitHub show it as written, and the triage UI reads the text between `<a2ui>` and `</a2ui>`.

The [triage_ui.sh](../../triage_ui.sh) command takes the item's URL, for example `https://github.com/a2ui-project/a2ui/issues/123`. GitHub shows a copy button on the code block, so the triager copies the command and pastes it into a terminal. The script:

1. Sends the URL to the triage UI if the app is running. The app listens on `127.0.0.1:47123`, accepts `POST /open` with the URL in the `item` form field, and accepts only URLs of issues and PRs in `a2ui-project/a2ui`.
2. Otherwise starts the app on macOS with `flutter run`, passing the URL as the app's argument.

The comment names people by their GitHub login in backticks, without `@`. A suggestion is not a decision yet, so it does not notify the people it names.

An item has at most one suggestion comment. When the suggestion is outdated, the advisor edits the comment instead of posting a new one, so that subscribers are not notified again.

## Current and outdated suggestions

A suggestion is **current** when nothing happened on the item after the suggestion comment was last edited. Otherwise it is **outdated**. Things that happen on an item are:

1. A comment, other than a triage bot comment.
2. A PR review.
3. An edit of the title or the description.
4. A commit pushed to a PR.
5. A change of labels, assignees or state, except adding or removing `status: needs-triage`. The flagger manages that label, so its changes say nothing new about the item.

## The `TriageSuggestion` component

The component is defined in [triage_suggestion.dart](../../pkgs/triage/lib/src/triage_item/triage_suggestion.dart). Its properties:

1. `summary` (required): what the item is about, in plain English.
2. `suggestion` (required): what the triager should do and why, in plain English.
3. `reply`: a comment for the item's author or other participants. When the suggestion is applied, the triage UI posts it from the triager's account.
4. `close_as`: how to close the item: `completed`, `not_planned` or `duplicate`. When it is omitted, the item stays open. A PR has no close reason, so any value closes it.
5. `duplicate_of`: the number of the item that this item duplicates. It is set only with `close_as: duplicate`.
6. `added_labels` and `removed_labels`: labels to add and remove.
7. `new_assignees` and `removed_assignees`: GitHub logins to assign and unassign.
8. `related_issues` and `related_prs`: numbers of related issues and PRs, which the triager may want to read. The triage UI does not change them.

Item numbers refer to the item's own repository. An omitted list means none.
