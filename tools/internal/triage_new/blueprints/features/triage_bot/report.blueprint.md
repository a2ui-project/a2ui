# Triage report

The terms are defined in [core.blueprint.md](../../core.blueprint.md). The [triage reporter](../../core.blueprint.md#triage-jobs) writes the report.

The triage report says what a team member triaged in a period, so that the team can read it in the go/a2ui-core-working-group chat space and in the go/a2ui-triage-log doc. The triager asks the triage bot for it, usually at the end of their triage week, as in "Create the triage report for last week". **Create report** in the [triage UI](../ui.blueprint.md#create-a-report) gives the triager such a prompt for the period of the triage UI session. The triage bot runs [triage_report.mts](../../../../../../.agents/skills/a2ui-triage-bot/scripts/triage_report.mts), which collects the activity from GitHub and writes the report.

An item is in the report when the person changed its labels, assignees or state in the period, or commented on it. These do not count:

1. Triage bot comments, which the triage bot posts from the person's account.
2. Adding or removing `status: needs-triage`, which the [flagger](../../../../triage/blueprints/flagging.blueprint.md) manages.
3. Closes by a commit or a merged PR, and the close that merges a PR.

Label and assignee changes are net: adding a label and removing it in the period cancel out.

The report starts with the period and the numbers: how many items the person triaged, how many of them were issues and PRs, how many items they sent to the team by adding `status: needs-team-input`, and, as "Remaining", how many open items still need triage.

The **Assigned for triage:** section follows: every open item with `status: assigned-for-triage`, except draft PRs, grouped by assignee, so that the team sees who still has triage to finish. The groups are in the order of the logins, and the items in each group in the order of their numbers. An item with several assignees is in the group of each, and items with no assignee are last, under **Nobody**. Each item has its URL and title. When no open item is assigned for triage, the section is the line "Assigned for triage: none".

Then the groups of what the person triaged follow, by what the person did: **Closed**, **Assigned P0** to **Assigned P3**, **Needs team input**, **Updated** for other changes, including assigning an item for triage, and **Commented** for the items the person only commented on. An item is in the first group that fits. Each group lists its items, with each item's URL, title and what the person did. The last line is "Created by triage bot skill", where "triage bot" links to the [a2ui-triage-bot](../../../../../../.agents/skills/a2ui-triage-bot/SKILL.md) skill.

The chat space does not render Markdown, so the report is plain text, and the triage bot puts it on the clipboard as rich text too, where the link to the skill works. Group headings are not list items: only the items under them are. For example:

```
Triage report for octocat, 2026-11-05 to 2026-11-11

Triaged 4 items: 3 issues and 1 PR.
Sent 1 issue to the team.
Remaining: 4.

Assigned for triage:

another-expert: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4060
    Add a DatePicker to the Angular renderer

octocat: 2 issues
  - https://github.com/a2ui-project/a2ui/issues/4050
    Support dialogs in the Flutter renderer
  - https://github.com/a2ui-project/a2ui/issues/4071
    Validate data bindings in the Python SDK

Closed: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4065
    Add a Slider to the Lit renderer: closed, commented

Assigned P3: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4080
    Fix typo in the quickstart: added P3

Needs team input: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4082
    Stream partial updates to the Angular renderer: added status: needs-team-input, commented

Commented: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4090
    Document the Express format: commented

Created by triage bot skill (https://github.com/a2ui-project/a2ui/blob/main/.agents/skills/a2ui-triage-bot/SKILL.md)
```

## After the report

After the report, the triage bot asks the triager which of these to do. The triager may choose any of them, and their choice is the approval to post.

1. **Unsubscribe the triager from the items in the report.** Triage subscribes the triager to the notifications of every item they comment on or assign. The triage bot unsubscribes them, as the **Unsubscribe** button on each item does. GitHub still notifies them when someone mentions them. The triage bot does not offer this when the report has no items, or is about someone other than the account it runs as.
2. **Post the report to the go/a2ui-core-working-group chat space**, as a new message from the triager's account.
3. **Add the report to go/a2ui-triage-log.** The triage log is a Google Doc. It starts with a header that ends with a horizontal line. The reports follow, newest first, each followed by a horizontal line. The triage bot inserts the new report right after the header's horizontal line, followed by its own horizontal line, and does not change the header or the earlier reports.

The triage bot posts with its Google Chat and Google Docs tools. When it has no such tool, [triage_report.mts](../../../../../../.agents/skills/a2ui-triage-bot/scripts/triage_report.mts) puts the report on the clipboard as rich text, in the form for the destination, and opens the destination in the browser, for the triager to paste it.
