---
name: a2ui-issue-triage
description: Automates the triage of GitHub issues in the A2UI repository. Helps the oncall engineer by fetching untriaged issues, generating AI-suggested priorities, assignees, and responses, launching a local review dashboard, and bulk-applying approved decisions to GitHub. Use when tasked with triaging new GitHub issues or managing the repository backlog.
---

# A2UI GitHub Issue Triage Skill

This skill guides the process of fetching, analyzing, reviewing, and applying triage decisions to GitHub issues in the A2UI repository using a local interactive dashboard.

> [!IMPORTANT]
> **WRITING GUIDELINES**
> When drafting replies, explanations, or any prose, refer to the [natural-writing](../natural-writing/SKILL.md) skill to ensure clarity, accuracy, and tone.

---

## Workflow

Follow these steps to triage new or backlog issues:

### Step 1: Fetch Untriaged Issues

Use the fetch script to retrieve all open issues lacking a priority label (`P0`, `P1`, `P2`, `P3`, `P4`) in the A2UI repository.

1. Run the fetch script to download the issues to a raw JSON file in your conversation-specific scratch directory:
   `python3 .agents/skills/a2ui-issue-triage/scripts/fetch_issues.py --repo "a2ui-project/a2ui" --output-file "<appDataDir>/brain/<conversation-id>/scratch/raw_issues.json"`

---

### Step 2: Analyze and Suggest Triage

Process the raw issues and generate recommended triage fields based on the project's triage criteria.

1. Read the triage criteria reference document: [triage_criteria.md](references/triage_criteria.md).
2. For each issue in `raw_issues.json`, evaluate its description and comments to determine:
   - **Priority**: `P0` (Urgent), `P1` (High), `P2` (Medium), `P3` (Low), or `None`.
   - **Assignee**: Recommended owner based on the affected component or area.
   - **Action**: `investigate`, `assign_and_fix`, `needs_info`, `close_duplicate`, `close_invalid`, or `close_resolved`.
   - **Labels**: Applicable repository labels (e.g. `type: bug`, `component: lit renderer`).
   - **Reply**: A polite, structured draft response addressing the author.
3. If an issue is a potential duplicate, perform at most three targeted GitHub searches to find matching canonical issues before suggesting `close_duplicate`.
4. **Natively Orchestrate Subagents**: Instead of running a Python script to spawn subagents (which can fail due to local workstation gRPC credential policies), the parent agent should natively orchestrate the parallel evaluations:
   - Load the first N issues (defaulting to 10, or as requested) from `raw_issues.json`.
   - Call the `invoke_subagent` tool in parallel for those issues. Prompt each subagent to analyze its assigned issue against the guidelines in [triage_criteria.md](references/triage_criteria.md) and return a structured JSON block containing `priority`, `action`, `labels`, and `reply`.
   - Once all subagents report back, compile their recommendations into the standard schema:
     - Map component labels to suggested assignees using git log history if necessary, and include a short sentence in `assignee_reason` explaining why they were chosen (e.g., "Suggesting gspencer because they recently modified related code").
     - Inject `total_issues_count` (preserving the total count from the raw issues JSON).
     - Save the final compiled payload to `issues_to_triage.json` in the scratch directory.

---

### Step 3: Launch Review Dashboard

Launch the interactive web dashboard to allow the oncall engineer to review and refine the suggested triages.

1. Start the local server as a background task, pointing it to your scratch directory:
   `python3 .agents/skills/a2ui-issue-triage/scripts/launch_dashboard.py --data-file "<appDataDir>/brain/<conversation-id>/scratch/issues_to_triage.json" --output-file "<appDataDir>/brain/<conversation-id>/scratch/triage_decisions.json"`
   Set `WaitMsBeforeAsync` to `1000` so the server runs in the background.
2. **Wait for Completion**: Stop calling tools and go idle. The launcher will automatically open the browser for the user and block until they click "Apply Triages" or "Abort". Once the user acts, the background task will complete, and you will receive a notification with the exit status.
3. **Verify Exit Status**:
   - If the task exited with status `0` (approved), proceed to apply the decisions.
   - If the task exited with a non-zero status (abort), don't modify any issues. You MUST STOP and ask the user for further instructions.

---

### Step 4: Apply Decisions to GitHub

Once the dashboard task exits successfully, **Execute Approved Decisions**: Run the apply script to update the approved labels, assignees, and comments on GitHub:

`python3 .agents/skills/a2ui-issue-triage/scripts/apply_triage.py --decisions-file "<appDataDir>/brain/<conversation-id>/scratch/triage_decisions.json"`

---

## Bundled Resources

- **[triage_criteria.md](references/triage_criteria.md)**: Authoritative guide for classifying issues, assigning priorities, and drafting response messages.
- **`scripts/fetch_issues.py`**: Script to query open, untriaged issues via the GitHub CLI.
- **`scripts/suggest_triage.py`**: Helper script to generate initial triage suggestions.
- **`scripts/launch_dashboard.py`**: Local HTTP server that opens the interactive web dashboard in the user's browser.
- **`assets/triage_dashboard.html`**: HTML/CSS/JS template for the triage review interface.
- **`scripts/apply_triage.py`**: Script to apply finalized triage decisions to GitHub.
