# GitHub issue triage

This developer skill automates the triage of GitHub issues in the A2UI repository. It fetches open issues that do not have a priority label, analyzes them, and opens a local web dashboard where you can review, edit, and apply the recommendations.

## How to prompt the agent

To start the triage workflow, ask the agent to run an issue triage skill: "Let's triage some issues on A2UI!". You can also ask the agent to run the skill directly: "Run the a2ui-issue-triage skill."

### Recommended prompt

> Triage the first 10 unprioritized issues in the repository.

### Guidelines for the prompt

- Specify a different count if needed. You can ask the agent to triage a specific number of issues (for example, 5 or 10). If you do not specify a number, the agent defaults to 10.
- Limit the number of issues. We recommend triaging at most 10 issues at a time. The agent spawns parallel subagents to analyze each issue. Triaging more than 10 issues at once can make the process slow and difficult to manage.
- Target specific issues. You can also ask the agent to triage specific issues if you want to focus on a particular set of issues, or only issues with specific attributes (labels, authors, milestone, etc.).
