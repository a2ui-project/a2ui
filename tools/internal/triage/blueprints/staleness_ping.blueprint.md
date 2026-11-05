# How the bot pings stale items

When an item becomes stale (see [thresholds.blueprint.md](thresholds.blueprint.md)), the bot first asks its assignees to act, and flags the item for triage only if nobody does. The ping goes to two places:

1. A comment on the issue or PR.
2. A message in the team's Google Chat space.

## When the bot pings

The ping runs as part of the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) workflow, on the same schedule and events as flagging. On every run the bot checks each open item:

1. If the item is not stale, it does nothing.
2. If the item is stale and has no current ping, it pings.
3. If the item is stale and has a current ping, it does nothing. Once the grace period after that ping ends, the flagging rules add `status: needs-triage`.

A ping is **current** when the bot posted it for the item's current case after that case's clock started (see [thresholds.blueprint.md](thresholds.blueprint.md)). Any activity that restarts the clock, such as a comment from the assignee on a `P1` issue, makes the old ping no longer current. If the item goes quiet again later, it gets a new ping. So the item gets one ping each time it becomes stale.

The bot keeps no state between runs. It finds its pings by reading its own comments on the item, and uses the comment's creation time as the time of the ping.

## The GitHub comment

The comment mentions every assignee, says which case applies and since when, and says what happens next. Each comment starts with a hidden marker that names the case, so the bot can find its pings on later runs:

```markdown
<!-- a2ui-triage-ping: p1-inactive -->
`@{assignee}` this `P1` issue has had no human activity for 30 days. Please post an update, or change the priority or assignee if the plan has changed. If nothing changes in 7 days, the issue gets `status: needs-triage` and goes back to the weekly triage.
```

The markers and messages for each case:

1. `assigned-for-triage`: "this item was assigned to you for triage 14 days ago. Please finish the triage and remove `status: assigned-for-triage`, or unassign yourself if someone else should do it."
2. `p0-inactive`: "this `P0` issue has had no human activity for 1 day. Please post an update."
3. `p1-inactive`: as in the example above.

Each message ends with the grace period and the consequence, as in the example.

The comment is a bot contribution, so it does not reset the staleness clock and does not count as a team reply in the flagging rules.

## The Google Chat message

After the GitHub comment is posted, the bot sends a message to the team's Google Chat space through an incoming webhook. The message has the item's title and link, the same text as the comment, and a mention of each assignee.

The bot reads two repository secrets:

1. `TRIAGE_CHAT_WEBHOOK_URL`: the webhook URL of the space.
2. `TRIAGE_CHAT_USERS`: a JSON object that maps GitHub logins to Google Chat user IDs. An assignee missing from the map is named by their GitHub login without a mention.

If `TRIAGE_CHAT_WEBHOOK_URL` is not set, the bot skips the Chat message and logs that it did.

## Failures

1. If the GitHub comment fails, there is no ping. The bot logs the error and tries again on the next run. The item cannot be flagged for staleness before its ping exists.
2. If the Chat message fails, the bot logs the error and does not retry. The GitHub comment already records the ping, and a retry on the next run would need its own record to avoid sending the message twice.

## Avoiding duplicate pings

Runs of the workflow never overlap (see `concurrency` in the workflow). Before posting, the bot also reads the item's comments again and skips the ping if a current one is already there, in case the comment listing it started from was out of date.

## Logging

The bot prints each item it pings, the case, and the assignees it mentioned, next to the flagging output.
