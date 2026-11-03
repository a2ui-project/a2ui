# How the automated triage bot works

The [triage.mjs](../../scripts/triage.mjs) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open issue and PR, adds `status: needs-triage` to the ones that match the conditions below, and removes the label from the rest.

An **external contributor** is anyone without the `OWNER`, `MEMBER` or `COLLABORATOR` association on the repository. Bots are external contributors too, so an issue filed by a workflow or a PR opened by dependabot needs triage like any other. A bot comment does not count as a reply, though: it does not change the latest human contribution, and it does not clear `status: waiting-for-author-response`.

The script uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

1. Does the item have `status: waiting-for-author-response` (the bot removes this label once a human external contributor responds)?

   - If yes: **NO LABEL**.
   - If no: continue processing.

2. Does the item have `status: assigned-for-triage`?

   - If yes:
     - **LABEL** when it has no assignee or got the label more than 14 days ago.
     - **NO LABEL** otherwise.
   - If no: continue processing.

3. Is the item **an issue**?

   - If yes, is it assigned?
     - If assigned:
       - **LABEL** when one of the following is true:
         - It is `P0` with no human activity for more than 1 day, or `P1` with no human activity for more than 30 days.
         - It has no priority label (`P0`–`P4`), and it was opened or commented by an external contributor.
       - **NO LABEL** otherwise.
     - If not assigned:
       - **LABEL** when one of the following is true:
         - It is `P0` or `P1`, which must have an assignee.
         - It has no priority label (`P0`–`P4`) and was opened or commented by an external contributor.
         - The latest human contribution is from an external contributor.
       - **NO LABEL** otherwise.
   - If no: continue processing.

4. Is the item **a PR**?

   - If yes:
     - **LABEL** when it was opened by an external contributor and the latest human contribution is from an external contributor, meaning no team member has responded yet.
     - **NO LABEL** otherwise.

Staleness is calculated from the last human contribution (comment, review, or issue/PR creation) rather than `updated_at` to avoid bot edits resetting the timer.

The bot prints to the console which items it flags or unflags and why. You can use this to track triage progress.

The workflow runs daily on a schedule (15:00 UTC / 07:00 PST), on manual dispatch, and automatically on issue events (opened, edited, labeled, unlabeled, assigned, unassigned, reopened), new issue comments, and submitted PR reviews or review comments.

Every run uses the script from `main`, whatever event triggers it. Without this, a PR review event runs the script from the PR's merge commit, which can contain an older version of the rules. Two versions then disagree on some items, and each run adds or removes the label that the previous run removed or added. To test a change to the rules, run the tests in [triage.test.mjs](../../scripts/triage.test.mjs) with `node --test scripts/`. Running the workflow from a branch still applies the rules from `main`.
