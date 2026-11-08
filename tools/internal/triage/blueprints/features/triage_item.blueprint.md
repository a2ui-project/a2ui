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

The suggestion comment is a [triage bot](../core.blueprint.md#contributors) comment. It has a plain English part for people, and a part for the triage UI, collapsed under **Details**. Both parts say the same thing.

````markdown
**From triage bot:**

## Triage suggestion

<summary>

<suggestion>

<the other properties that have values, as a numbered list>

<details>
<summary>Details</summary>

```
<a2ui>
<the TriageSuggestion component in A2UI Express>
</a2ui>
```

</details>
````

The component is written in [A2UI Express](../../../../../specification/inference_formats/express/Express.g4), as one `root = TriageSuggestion(...)` statement. The code fence makes GitHub show it as written, and the triage UI reads the text between `<a2ui>` and `</a2ui>`.

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
