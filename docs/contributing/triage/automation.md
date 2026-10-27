# How the automated triage bot works

The [triage.mjs](../../scripts/triage.mjs) script runs via the [`Flag/Unflag issues and PRs`](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/triage.yml) GitHub Actions workflow. It checks every open issue and PR, adds `status: needs-triage` to the ones that match the conditions below, and removes the label from the rest.

The script uses the following rules to decide if a PR or issue should get **the label `status: needs-triage`**:

1. Does the item have `status: waiting-for-author-response` (the bot removes this label once an external contributor responds)?

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
