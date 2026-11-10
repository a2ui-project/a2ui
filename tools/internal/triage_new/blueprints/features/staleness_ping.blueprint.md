# Staleness pinger

(under construction)

The staleness pinger asks the assignees of [stale items](#stale-items) to act before the [flagger](../../../triage/blueprints/flagging.blueprint.md) flags the item for triage. The terms are defined in [core.blueprint.md](../core.blueprint.md).

The pinger runs daily. For each stale item without a [current ping](#staleness-pings), it:

1. Posts a [triage bot](../core.blueprint.md#contributors) comment on the issue or PR.
2. Sends a message to the team's Google Chat space.

The pinger keeps no state between runs. It finds its earlier pings by the marker in its comments, and uses the comment's creation time as the time of the ping.

## Staleness pings

A **staleness ping** is a triage bot comment that the staleness pinger posts on a stale item, marked with the item's case.

A ping is **current** when it was posted for the item's current case after that case's clock started: the latest `status: assigned-for-triage` labeling for case 1, or the last **out-of-team contributor** contribution for cases 2, 3 and 4.

A current ping is **expired** when it is older than the grace period of its case and the item is still stale.

## Stale items

An open issue or PR is **stale** when it matches one of these cases:

1. **Triage assignment.** Issue or PR that has `status: assigned-for-triage`, at least one assignee, and the label was last added more than 14 days ago. Grace period: 7 days.
2. **Inactive `P0`.** It is an issue with `P0`, at least one assignee, and no team member contribution for more than 1 day. Grace period: 1 day.
3. **Inactive `P1`.** It is an issue with `P1`, at least one assignee, and no team member contribution for more than 30 days. Grace period: 7 days.
4. **Inactive external PR.** It is a PR opened by an out-of-team contributor, with at least one assignee, without `status: waiting-for-author-response`, and with no team member contribution for more than 14 days. Grace period: 7 days.

## The GitHub comment

The pinger posts the comment from a team member's account, so that the comment is a triage bot comment. The comment mentions every assignee, says why the item is stale, and says what happens if nothing changes. It starts with the triage bot prefix and ends with a hidden marker that names the case:

```markdown
**From triage bot:** @{assignee} this `P1` issue has had no human activity for 30 days. Please post an update, or change the priority or assignee if the plan has changed. If nothing changes in 7 days, the issue gets `status: needs-triage` and goes back to the weekly triage.
<!-- a2ui-triage-ping: p1-inactive -->
```

The marker and the first sentence for each case:

1. `assigned-for-triage`: "this item was assigned to you for triage 14 days ago. Please finish the triage and remove `status: assigned-for-triage`, or unassign yourself if someone else should do it."
2. `p0-inactive`: "this `P0` issue has had no human activity for 1 day. Please post an update."
3. `p1-inactive`: as in the example above.
4. `external-pr-inactive`: "this PR from an out-of-team contributor has had no response from the team for 14 days. Please review it, or tell the author what is next."

## The Google Chat message

The pinger sends the message through an incoming webhook. It has the item's title and link, the text of the comment, and a mention of each assignee.

The pinger reads two repository secrets:

1. `TRIAGE_CHAT_WEBHOOK_URL`: the webhook URL of the space. If it is not set, the pinger skips the message and logs that it did.
2. `TRIAGE_CHAT_USERS`: a JSON object that maps GitHub logins to Google Chat user IDs. An assignee missing from the map is named by their GitHub login, without a mention.

## Failures

1. If the GitHub comment fails, the pinger opens a GitHub issue with the error details.
2. If the Chat message fails, the pinger logs the error and does not retry.

The pinger prints each item it pings, the case, and the assignees it mentioned.
