# Triage helper

The triage helper supports the people who run the [triage process](../../docs/contributing/triage/triage.md).

## CUJ: triager, offline

Before the weekly meeting, the triager burns the queue "Needs triage, without team input" and sets aside what needs the team.

1. **Triager:** starts the helper.
2. **Tool:** shows the queue: open items with `status: needs-triage` in `a2ui-project/a2ui` and `flutter/genui`, without `status: needs-team-input`. Next to each item, it shows why the bot flagged it, for example "P1, no human activity for 34 days" or "external comment unanswered". A click on an item's title opens the item on GitHub in the browser.
3. **Triager:** opens an item.
4. **Tool:** shows a summary of the item, with a link that opens it on GitHub in the browser, and a drafted decision:
   - For an issue: a priority, possible duplicates, and the matching reply from [templates.md](../../docs/contributing/triage/templates.md).
   - For a PR: whether it meets the review principles. Is it a minor change? Does it link an issue assigned to its author? Do other open PRs touch the same files? If it does not meet them, the standard decline reply.
5. **Triager:** edits the draft if needed and picks an action:
   - Triage: set the priority, post the reply, and close the item if needed.
   - Decline a PR: post the decline reply and close the PR.
   - Wait for the author: comment question and add `status: waiting-for-author-response`.
   - Defer to the meeting: add `status: needs-team-input`, with an optional comment.
6. **Tool:**
   - applies the action on GitHub, removes 'status: needs triage' and opens the next item.
   - in background monitors if the 'status: needs triage' reappiar

   Steps 4 to 6 repeat until the queue is empty.

7. **Triager:** at any time can open the triage card.
8. **Tool:** shows a draft of the triage card, to paste into go/a2ui-triage-log: the queue size at the start and at the end, the items triaged, and the items deferred.

## CUJ: triage meeting

At the meeting, the triager shares the screen, and the team burns `status: needs-team-input`. The conversation is the same as in the offline CUJ, with these differences:

- **Step 2:** the queue is the items with `status: needs-team-input`, and each item also shows the triager's comment.
- **Step 4:** the tool also suggests experts, from the git history of the code the item is about.
- **Step 5:** the triager picks an action after the team discusses the item. Each action also removes `status: needs-team-input`. "Defer to the meeting" is replaced by "Assign an expert": set the assignee and add `status: assigned-for-triage`.
- **Step 8:** the tool also drafts the message for the team chat.

## CUJ: assigned for triage

An expert assigned to an item with `status: assigned-for-triage` has 14 days to triage it. The expert has the conversation of the offline CUJ, with these differences:

- **Step 2:** the queue is the items assigned to the expert with `status: assigned-for-triage`. Next to each item, the tool shows the days left instead of the reason for the flag.
- **Step 4:** the summary also includes the related code and its recent commits, and related issues and PRs.
- **Step 5:** each action also removes `status: assigned-for-triage`.
- **Steps 7 and 8:** skipped. The expert does not fill in a triage card.

## Requirements for all CUJs

- **The helper uses the bot's rules.** It reuses the code in [triage.mjs](../../scripts/triage.mjs) instead of copying it: `flagReason()` for why an item is flagged, and `labelsAddedAt()` for when `status: assigned-for-triage` was added. Two copies of the rules that disagree undo each other's labels, as [triage_flagging.blueprint.md](triage_flagging.blueprint.md) describes. With the same rules, the helper can also show whether an action clears the flag.
- **Replies use the canonical wording** from [templates.md](../../docs/contributing/triage/templates.md) and the decline reply in [triage.md](../../docs/contributing/triage/triage.md#triage-a-pr).
