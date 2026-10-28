# Decisions made for the triage process

## Why do we need P4 when there is P3?

`P3` and `P4` tell the reporter different things:

1. `P3`: the team does not plan the work now, but it may become a priority.
2. `P4`: the team does not plan to invest in it, and does not review PRs for it.

Without `P4`, a reporter of a `P3` issue cannot tell whether a contribution is welcome, and may spend time on a PR the team will decline.

## Why not close P4 issues?

1. The [`P4` filter](https://github.com/a2ui-project/a2ui/issues?q=is%3Aissue%20state%3Aopen%20label%3AP4) lists exactly the requests the team decided not to invest in. The closed issues mix those with fixed issues, duplicates, and invalid reports.
2. Only the team can change a label, while the author can reopen a closed issue.
3. An open issue shows up when someone searches open issues for the same request. They find the team's answer and add their arguments there instead of filing a duplicate.
