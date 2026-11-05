# How the flagging script works

The triage process the script supports is described in [docs/contributing/triage/triage.md](../../../../docs/contributing/triage/triage.md).

The [flagging.mts](../flagging/flagging.mts) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open issue and PR, adds `status: needs-triage` to the ones that match the rules below, and removes the label from the rest. The terms are defined in [definitions.blueprint.md](definitions.blueprint.md).

A stale item is not flagged right away. The [staleness ping job](staleness_ping.blueprint.md) pings its assignees first, and the script flags the item only once the ping has expired.

The script uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

1. Does the item have `status: waiting-for-author-response`?

   The script removes this label once an out-of-team contributor makes a human contribution after the label was added.

   - If yes: **NO LABEL**.
   - If no: continue processing.

2. Is the item stale, with an expired staleness ping?

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

Every run uses the script from `main`, whatever event triggers it. Otherwise a PR review event runs the copy from the PR's merge commit, which can have older rules, and the two copies keep undoing each other's labels. Running the workflow from a branch also applies the rules from `main`, so test a rule change with `node --test tools/internal/triage/flagging/flagging.test.mts`.
