# How the automated triage bot works

The [triage.mts](../flagging/triage.mts) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open issue and PR, adds `status: needs-triage` to the ones that match the conditions below, and removes the label from the rest.

A stale item, one that a team member owns but has gone quiet (see [thresholds.blueprint.md](thresholds.blueprint.md)), is not flagged right away. The bot first pings its assignees (see [ping.blueprint.md](ping.blueprint.md)), and flags the item only if it is still stale when the grace period after the ping ends.

An **external contributor** is anyone without the `OWNER`, `MEMBER` or `COLLABORATOR` association on the repository. Bots are external contributors too, so an issue filed by a workflow or a PR opened by dependabot needs triage like any other. A bot comment does not count as a reply, though: it does not change the latest human contribution, and it does not clear `status: waiting-for-author-response`.

The script uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

1. Does the item have `status: waiting-for-author-response` (the bot removes this label once a human external contributor responds)?

   - If yes: **NO LABEL**.
   - If no: continue processing.

2. Is the item stale, with a ping older than the grace period for its case (see [thresholds.blueprint.md](thresholds.blueprint.md) and [ping.blueprint.md](ping.blueprint.md))?

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
       - **LABEL** when it has no priority label (`P0`–`P3`), and it was opened or commented by an external contributor.
       - **NO LABEL** otherwise.
     - If not assigned:
       - **LABEL** when one of the following is true:
         - It is `P0` or `P1`, which must have an assignee.
         - It has no priority label (`P0`–`P3`) and was opened or commented by an external contributor.
         - The latest human contribution is from an external contributor.
       - **NO LABEL** otherwise.
   - If no: continue processing.

5. Is the item **a PR**?

   - If yes:
     - **LABEL** when it was opened by an external contributor and the latest human contribution is from an external contributor, meaning no team member has responded yet.
     - **NO LABEL** otherwise.

The bot prints to the console which items it flags or unflags and why. You can use this to track triage progress.

The workflow runs daily on a schedule (15:00 UTC / 07:00 PST), on manual dispatch, and automatically on issue events (opened, edited, labeled, unlabeled, assigned, unassigned, reopened), new issue comments, and submitted PR reviews or review comments.

Every run uses the script from `main`, whatever event triggers it. Without this, a PR review event runs the script from the PR's merge commit, which can contain an older version of the rules. Two versions then disagree on some items, and each run adds or removes the label that the previous run removed or added. To test a change to the rules, run the tests in [triage.test.mts](../flagging/triage.test.mts) with `node --test tools/internal/triage/flagging/triage.test.mts`. Running the workflow from a branch still applies the rules from `main`.
