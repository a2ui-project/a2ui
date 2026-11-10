# Flagger

The flagger adds `status: needs-triage` to every open issue and PR that matches the rules below, and removes the label from the rest. It supports the process described in [triage.md](../../../../../docs/contributing/triage/triage.md). The terms are defined in [core.blueprint.md](../core.blueprint.md).

The flagger is the [flagging.mts](../../archive/packages/flagging/flagging.mts) script, which runs in the [`Flag/Unflag issues and PRs`](../../../../../.github/workflows/triage.yml) GitHub Actions workflow.

The script handles [triage bot](../core.blueprint.md#contributors) comments in two ways:

1. A staleness ping delays flagging. A stale item is not flagged right away: the [staleness pinger](staleness_ping.blueprint.md) pings its assignees first, and the script flags the item only once the ping has expired (rule 2). The ping does not count as activity, so it does not restart the clock that made the item stale.
2. In all other rules, the script ignores triage bot comments. For example, a [triage suggestion](triage_item.blueprint.md#triage-suggestions) does not answer `status: waiting-for-author-response` (rule 1). It also does not count as the team's response to an item (rules 4 and 5), so the item stays flagged until a team member acts on it.

The script uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

1. Does the item have `status: waiting-for-author-response`?

   The script removes this label once an out-of-team contributor makes a human contribution after the label was added.

   - If yes: **NO LABEL**.
   - If no: continue processing.

2. Is the item [stale](staleness_ping.blueprint.md#stale-items), with an [expired staleness ping](staleness_ping.blueprint.md#staleness-pings)?

   - If yes: **LABEL**.
   - If no: continue processing.

3. Does the item have `status: assigned-for-triage`?

   - If yes:
     - **LABEL** when it has no assignee.
     - **NO LABEL** otherwise.
   - If no: continue processing.

4. Is the item **an issue**?

   - If yes, is it assigned?
     - If assigned:
       - **LABEL** when it has no priority label (`P0`–`P3`) and was opened or commented on by an out-of-team contributor.
       - **NO LABEL** otherwise.
     - If not assigned:
       - **LABEL** when one of the following is true:
         - It is `P0` or `P1`, which must have an assignee.
         - It has no priority label (`P0`–`P3`) and was opened or commented on by an out-of-team contributor.
         - The last human contribution is from an out-of-team contributor.
       - **NO LABEL** otherwise.
   - If no: continue processing.

5. Is the item **a PR**?

   - If yes:
     - **LABEL** when it was opened by an out-of-team contributor and the last human contribution is from an out-of-team contributor, meaning no team member has responded yet.
     - **NO LABEL** otherwise.

The script prints which items it flags or unflags and why.

The workflow runs daily on a schedule (15:00 UTC / 07:00 PST), on manual dispatch, and on issue events (opened, edited, labeled, unlabeled, assigned, unassigned, reopened), new issue comments, and submitted PR reviews or review comments.

Every run uses the script from `main`, whatever event triggers it. Otherwise a PR review event runs the copy from the PR's merge commit, which can have older rules, and the two copies keep undoing each other's labels. Running the workflow from a branch also applies the rules from `main`, so test a rule change with `node --test tools/internal/triage/archive/packages/flagging/flagging.test.mts`.
