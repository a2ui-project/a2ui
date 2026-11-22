# Staleness pinger

The staleness pinger asks the assignees of [stale items](#stale-items) to act before the [flagger](../flagger.blueprint.md) flags the item for triage. The terms are defined in [core.blueprint.md](../../core.blueprint.md).

The [triage bot](../../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) runs the pinger hourly. For each stale item without a [current ping](#staleness-pings), the pinger:

1. Posts a [triage bot](../../core.blueprint.md#contributors) comment on the issue or PR.
2. Sends a message to the team's Google Chat space.

The pinger keeps no state between runs. It finds its earlier pings by the marker in its comments, and uses the comment's creation time as the time of the ping.

The code is in [`pkgs/pinger`](../../../pkgs/pinger/). The definitions of stale items and pings are in the [`shared`](../../../pkgs/shared/lib/src/shared/staleness.dart) package, since the flagger uses them too.

## Stale items

An open issue or PR is **stale** when it matches one of these cases. A [draft PR](../../core.blueprint.md#draft-prs) is never stale, and neither is an item with `status: waiting-for-author-response`, which waits for its author rather than its assignees.

1. **Triage assignment.** Issue or PR that has `status: assigned-for-triage`, at least one assignee, and the label was last added more than 14 days ago. Grace period: 7 days.
2. **Inactive `P0`.** It is an issue with `P0`, at least one assignee, and no team member contribution for more than 1 day. Grace period: 1 day.
3. **Inactive `P1`.** It is an issue with `P1`, at least one assignee, and no team member contribution for more than 30 days. Grace period: 7 days.
4. **Inactive external PR.** It is a PR opened by an out-of-team contributor, with at least one assignee, and with no team member contribution for more than 14 days. Grace period: 7 days.

An item matches at most one case: case 1 when it has `status: assigned-for-triage`, and otherwise the case of its kind and its most urgent priority.

The **clock** of a case starts at the latest `status: assigned-for-triage` labeling for case 1, and at the latest team member contribution for cases 2, 3 and 4: a comment, a PR review or a review comment, other than a triage bot comment or a bot's. Without such a contribution, the clock starts at the item's creation.

## Staleness pings

A **staleness ping** is a triage bot comment that the staleness pinger posts on a stale item, marked with the item's case.

A ping is **current** when it was posted for the item's current case after that case's clock started. A team member's update restarts the clock, so a ping posted before it is no longer current.

A current ping is **expired** when it is older than the grace period of its case and the item is still stale. The [flagger](../flagger.blueprint.md) then flags the item, in its step 2.

## The GitHub comment

The pinger posts the comment from a team member's account, so that the comment is a triage bot comment. The comment mentions every assignee, says why the item is stale, and says what happens if nothing changes. It starts with `**From triage bot, ping:**` and ends with a hidden marker that names the case:

```markdown
**From triage bot, ping:** @{assignee} this `P1` issue has had no update from the team for 30 days. Please post an update, or change the priority or assignee if the plan has changed. If nothing changes in 7 days, the issue gets `status: needs-triage` and goes back to the weekly triage.
<!-- a2ui-triage-ping: p1-inactive -->
```

The marker and the first sentence for each case, where `{days}` is the age of the clock in whole days and `{kind}` is "issue" or "PR":

1. `assigned-for-triage`: "this {kind} was assigned to you for triage {days} ago. Please finish the triage and remove `status: assigned-for-triage`, or unassign yourself if someone else should do it."
2. `p0-inactive`: "this `P0` issue has had no update from the team for {days}. Please post an update."
3. `p1-inactive`: as in the example above.
4. `external-pr-inactive`: "this PR from an out-of-team contributor has had no response from the team for {days}. Please review it, or tell the author what is next."

## The Google Chat message

The pinger sends the message through an incoming webhook. The message starts with `From triage bot, ping:` in bold, written `*From triage bot, ping:*` in the Google Chat format, so that readers can tell it from messages that people write. After that, it has the item's title and link, and the text of the comment without its prefix and marker, where each assignee is mentioned in Google Chat.

The pinger reads two environment variables:

1. `TRIAGE_CHAT_WEBHOOK_URL`: the webhook URL of the space. If it is not set, the pinger skips the messages and says so.
2. `TRIAGE_CHAT_USERS`: a JSON object that maps GitHub logins to Google Chat user IDs. An assignee missing from the map is named by their GitHub login, without a mention.

## Failures

1. If a GitHub comment fails, the pinger logs the error and goes on with the next item. The next run tries again, since the item still has no current ping.
2. If a Chat message fails, the pinger logs the error and does not retry.
3. If the first comment turns out to come from an account outside the team, the pinger deletes it and stops. Such a comment is not a triage bot comment, so the next run would not see it and would ping again.

The pinger exits with an error when anything fails, and the triage bot reports the errors. It prints each item it pings, the case, and the assignees it mentioned.
