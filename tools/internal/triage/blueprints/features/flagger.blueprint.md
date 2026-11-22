# Flagger

The [flagger](../../pkgs/flagger/) runs in the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open issue and PR, adds `status: needs-triage` to the ones that match the conditions below, and removes the label from the rest.

An **out-of-team contributor** is anyone without the `OWNER`, `MEMBER` or `COLLABORATOR` association on the repository. Bots are out-of-team contributors too, so an issue filed by a workflow or a PR opened by dependabot needs triage like any other. A bot comment does not count as a reply, though: it does not change the latest human contribution, and it does not clear `status: waiting-for-author-response`.

A [triage bot](../core.blueprint.md#contributors) comment, which starts with `**From triage bot,` or `**From triage bot:` and is posted from a team member's or a bot's account, is output from the triage tooling. The flagger does not count it as a contribution, so a triage suggestion does not reset the staleness clock or answer an out-of-team comment. It reads one kind of triage bot comment, the staleness pinger's pings, in step 2.

The flagger uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

0. Is the item **a draft PR**?

   - If yes: **NO LABEL**. A draft PR is still in its author's hands, so it is not triage work until the author marks it ready for review.
   - If no: continue processing.

1. Does the item have `status: waiting-for-author-response` (the flagger removes this label once an out-of-team contributor responds)?

   - If yes: **NO LABEL**.
   - If no: continue processing.

2. Is the item [stale](triage_bot/staleness_ping.blueprint.md#stale-items), with an [expired staleness ping](triage_bot/staleness_ping.blueprint.md#staleness-pings)? The staleness pinger asked its assignees to act, and the grace period passed.

   - If yes: **LABEL**, whoever opened the item, since the ping said that the item goes back to triage. Stale items get pings only while someone runs the [triage bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md), so until then they stay unflagged.
   - If no: continue processing.

3. Does the item have `status: assigned-for-triage`?

   - If yes:
     - **LABEL** when it has no assignee.
     - **NO LABEL** otherwise. An assignment that stays open too long is flagged by step 2.
   - If no: continue processing.

4. Was the item opened by a team member, with no unanswered contribution from an out-of-team contributor? A contribution (a comment, a PR review or a review comment) is unanswered while it is the latest human contribution, so a reply or review from a team member answers it.

   - If yes: **NO LABEL**.
   - If no: continue processing.

5. Is the item **an issue**?

   - If yes, is it assigned?
     - If assigned:
       - **LABEL** when it has no priority label (`P0`–`P3`). A stale `P0` or `P1` issue is flagged by step 2.
       - **NO LABEL** otherwise.
     - If not assigned:
       - **LABEL** when one of the following is true:
         - It is `P0`.
         - It is `P1` without milestone.
         - It has no priority label (`P0`–`P3`).
         - The latest human comment is from an out-of-team contributor.
       - **NO LABEL** otherwise.
   - If no: continue processing.

6. Is the item **a PR**?

   - If yes:
     - **LABEL** when one of the following is true:
       - It has no assignee.
       - It was opened by a team member, has an assignee, and has been stale for more than 7 days. A stale PR from an out-of-team contributor is flagged by step 2.
     - **NO LABEL** otherwise.

The opening post does not count as a comment.

In step 6, staleness is calculated from the last human contribution (a comment, a PR review or review comment, or the item's creation) rather than `updated_at` to avoid bot edits resetting the timer. Pushing commits to a PR does not count as a contribution.

The flagger prints to the console which items it flags or unflags and why. You can use this to track triage progress. To see why specific items are flagged, without changing their labels, run [flag_reason.dart](../../pkgs/flagger/bin/flag_reason.dart) from the repository root, with item numbers or URLs: `dart run tools/internal/triage/pkgs/flagger/bin/flag_reason.dart 123 456`. It reads GitHub with `GITHUB_TOKEN`, or else with the token of the account that the `gh` CLI is logged in to. The [triage bot](../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) uses it for the `reason` of its suggestions.

The workflow runs daily on a schedule (15:00 UTC / 07:00 PST), on manual dispatch, and automatically on issue events (opened, edited, labeled, unlabeled, assigned, unassigned, milestoned, demilestoned, reopened), new issue comments, and submitted PR reviews or review comments.

Every run uses the flagger from `main`, whatever event triggers it. Without this, a PR review event runs the flagger from the PR's merge commit, which can contain an older version of the rules. Two versions then disagree on some items, and each run adds or removes the label that the previous run removed or added. To test a change to the rules, run the tests in [`test/flagger/`](../../pkgs/flagger/test/flagger/) with `dart test` in [`tools/internal/triage/pkgs/flagger`](../../pkgs/flagger/). Running the workflow from a branch still applies the rules from `main`.
