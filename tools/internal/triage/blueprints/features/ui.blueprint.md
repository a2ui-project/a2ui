# Triage UI

The triage UI is a Flutter application that helps the triager go through the items that need triage. It is not implemented yet. The terms are defined in [core.blueprint.md](../core.blueprint.md).

The triager runs it weekly, during [second line triage](../../../../../docs/contributing/triage/triage.md#second-line-triage-weekly-by-triager). For each item with `status: needs-triage`, it:

1. Parses the [triage suggestion](triage_item.blueprint.md#triage-suggestions) from the item's suggestion comment.
2. Shows the item and the suggestion to the triager.
3. Lets the triager change the suggestion.
4. Applies the suggestion when the triager clicks **Apply**: posts the reply, changes the labels and assignees, and closes the item if the suggestion says so.

Once the item is triaged, the [flagger](flagging.blueprint.md) removes its `status: needs-triage`.
