# Staleness cases and thresholds

An open issue or PR is **stale** when a team member owns it and it has gone quiet for longer than its case allows. The bot handles a stale item in two stages:

1. It pings the assignees on GitHub and in Google Chat, as described in [ping.blueprint.md](staleness_ping.blueprint.md).
2. If the item is still stale when the grace period after the ping ends, the bot adds `status: needs-triage`, as described in [flagging.blueprint.md](flagging.blueprint.md).

## Cases

1. **Triage assignment.** An issue or PR with `status: assigned-for-triage` and at least one assignee is stale 14 days after the label was last added. The grace period after the ping is 7 days.
2. **Inactive `P0`.** An issue with `P0` and at least one assignee is stale after 1 day with no human contribution. The grace period after the ping is 1 day.
3. **Inactive `P1`.** An issue with `P1` and at least one assignee is stale after 30 days with no human contribution. The grace period after the ping is 7 days.

## What is never stale

1. A closed item.
2. An item with `status: waiting-for-author-response`. The team is waiting for someone outside it, so the team's silence is expected.

## The last human contribution

Cases 2 and 3 measure time from the last human contribution: the newest comment, review, or inline review comment from a human, or the opening of the item if there are none. The bot ignores the following:

1. Contributions from bots, including the bot's own ping comments. Otherwise the ping would reset the clock it reports on.
2. Changes to labels, assignees, the title, or the description.
3. The item's `updated_at`, which bot edits also change.
