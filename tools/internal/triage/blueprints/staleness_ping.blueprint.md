# How the staleness ping job works

The staleness ping job asks the assignees of [stale items](definitions.blueprint.md#stale-items) to act before the item is flagged for triage. It is a separate job from the [flagging script](flagging.blueprint.md), which only reads the pings to decide when to flag.

The job runs daily. For each stale item without a [current ping](definitions.blueprint.md#staleness-pings), it does the following:

1. Posts a [triage bot](definitions.blueprint.md#contributors) comment on the issue or PR.
2. Sends a message to the team's Google Chat space.

The job keeps no state between runs. It finds its earlier pings by the marker in its comments, and uses the comment's creation time as the time of the ping.

## The GitHub comment

The job posts the comment from a team member's account, so that the comment is a triage bot comment. The comment mentions every assignee, says why the item is stale, and says what happens if nothing changes. It starts with the triage bot prefix and ends with a hidden marker that names the case:

```markdown
**From triage bot:** `@{assignee}` this `P1` issue has had no human activity for 30 days. Please post an update, or change the priority or assignee if the plan has changed. If nothing changes in 7 days, the issue gets `status: needs-triage` and goes back to the weekly triage.
<!-- a2ui-triage-ping: p1-inactive -->
```

The marker and the first sentence for each case:

1. `assigned-for-triage`: "this item was assigned to you for triage 14 days ago. Please finish the triage and remove `status: assigned-for-triage`, or unassign yourself if someone else should do it."
2. `p0-inactive`: "this `P0` issue has had no human activity for 1 day. Please post an update."
3. `p1-inactive`: as in the example above.

## The Google Chat message

The job sends the message through an incoming webhook. It has the item's title and link, the text of the comment, and a mention of each assignee.

The job reads two repository secrets:

1. `TRIAGE_CHAT_WEBHOOK_URL`: the webhook URL of the space. If it is not set, the job skips the message and logs that it did.
2. `TRIAGE_CHAT_USERS`: a JSON object that maps GitHub logins to Google Chat user IDs. An assignee missing from the map is named by their GitHub login, without a mention.

## Failures and duplicates

1. If the GitHub comment fails, there is no ping. The job logs the error and tries again on the next run.
2. If the Chat message fails, the job logs the error and does not retry, because the GitHub comment already records the ping.
3. Runs of the job must not overlap. Before posting, the job reads the item's comments again and skips the ping if a current one is already there.

The job prints each item it pings, the case, and the assignees it mentioned.
