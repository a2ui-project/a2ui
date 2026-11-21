# How the automated triage bot works

The [triage.mts](../flagging/triage.mts) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open issue and PR, adds `status: needs-triage` to the ones that match the conditions below, and removes the label from the rest.

An **out-of-team contributor** is anyone without the `OWNER`, `MEMBER` or `COLLABORATOR` association on the repository. Bots are out-of-team contributors too, so an issue filed by a workflow or a PR opened by dependabot needs triage like any other. A bot comment does not count as a reply, though: it does not change the latest human contribution, and it does not clear `status: waiting-for-author-response`.

A team member's comment that starts with `From triage bot` (in bold or not) is output from the triage tooling posted from that person's account. The bot ignores it completely, so a triage suggestion does not reset the staleness clock or answer an out-of-team comment.

The script uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

1. Does the item have `status: waiting-for-author-response` (the bot removes this label once an out-of-team contributor responds)?

   - If yes: **NO LABEL**.
   - If no: continue processing.

2. Does the item have `status: assigned-for-triage`?

   - If yes:
     - **LABEL** when it has no assignee or got the label more than 14 days ago.
     - **NO LABEL** otherwise.
   - If no: continue processing.

3. Was the item opened by a team member, with no unanswered contribution from an out-of-team contributor? A contribution (a comment, a PR review or a review comment) is unanswered while it is the latest human contribution, so a reply or review from a team member answers it.

   - If yes: **NO LABEL**.
   - If no: continue processing.

4. Is the item **an issue**?

   - If yes, is it assigned?
     - If assigned:
       - **LABEL** when one of the following is true:
         - It is `P0` and has been stale for more than 1 day.
         - It is `P1` and has been stale for more than 30 days.
         - It has no priority label (`P0`–`P3`).
       - **NO LABEL** otherwise.
     - If not assigned:
       - **LABEL** when one of the following is true:
         - It is `P0`.
         - It is `P1` without milestone.
         - It has no priority label (`P0`–`P3`).
         - The latest human comment is from an out-of-team contributor.
       - **NO LABEL** otherwise.
   - If no: continue processing.

5. Is the item **a PR**?

   - If yes:
     - **LABEL** when one of the following is true:
       - It has no assignee.
       - It has an assignee and has been stale for more than 7 days.
     - **NO LABEL** otherwise.

The opening post does not count as a comment.

Staleness is calculated from the last human contribution (a comment, a PR review or review comment, or the item's creation) rather than `updated_at` to avoid bot edits resetting the timer. Pushing commits to a PR does not count as a contribution.

The bot prints to the console which items it flags or unflags and why. You can use this to track triage progress.

The workflow runs daily on a schedule (15:00 UTC / 07:00 PST), on manual dispatch, and automatically on issue events (opened, edited, labeled, unlabeled, assigned, unassigned, milestoned, demilestoned, reopened), new issue comments, and submitted PR reviews or review comments.

Every run uses the script from `main`, whatever event triggers it. Without this, a PR review event runs the script from the PR's merge commit, which can contain an older version of the rules. Two versions then disagree on some items, and each run adds or removes the label that the previous run removed or added. To test a change to the rules, run the tests in [triage.test.mts](../flagging/triage.test.mts) with `node --test tools/internal/triage/flagging/triage.test.mts`. Running the workflow from a branch still applies the rules from `main`.
