# Triage flagging bot

The bot adds `status: needs-triage` to open issues and PRs that need attention from the team, and removes it once they don't. The [`Flag/Unflag issues and PRs`](../../../../.github/workflows/triage.yml) workflow runs it daily and on issue and PR events.

- [blueprint.md](blueprint.md): the rules the bot follows.
- [triage.mjs](triage.mjs): the script that applies the rules.
- [triage.test.mjs](triage.test.mjs): tests. Run them from the repository root with `node --test tools/internal/triage/flagging/triage.test.mjs`.

The triage process the bot supports is described in [docs/contributing/triage/triage.md](../../../../docs/contributing/triage/triage.md).
