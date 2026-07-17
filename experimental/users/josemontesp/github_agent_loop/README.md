# Github Agent Loop Orchestrator

This repository contains the python scaffolding for the hybrid open-source agentic orchestrator (Github Agent) for the `a2ui-project/a2ui` GitHub repository.

## Components
- `github_agent_state.py`: Manages the state schema translation and persistent JSON saving for the google chat integration.
- `github_webhook_sidecar.py`: Listens to incoming GitHub actions and webhooks, guarded by an allowlist (trusted googlers).
- `orchestrator.py`: The parent heartbeat daemon that pokes sidecars and spawns self-assessment/remediation routines via Agent API.
- `sidecars/dashboard/dashboard.py`: A local sidecar service that provides a clean web UI tracking the health and status of active projects managed by the agent.

## Documentation
- Detailed architectural designs are tracked in `design.md`.
- Skills for subagents are housed under the `skills/` directory and evaluated using internal `skill-improver` routines.

## Orchestrator Dashboard

The Orchestrator Dashboard parses the agent's internal state file (`~/.gemini/jetski/github_agent_state.json`) and shows:
* Active/inactive projects and their respective target threads.
* Current execution phase (`DEVELOPING`, `REVIEW_PENDING`, `COMPLETED`, etc.).
* Run status (`ACTIVE` vs `INACTIVE`).
* Git branch and worktree path.
* Link to the open GitHub PR.

### How to Run Locally

You can run the dashboard manually:
```bash
python3 experimental/users/josemontesp/github_agent_loop/sidecars/dashboard/dashboard.py
```

By default, it listens on port `8080`. You can override this using the `ANTIGRAVITY_SIDECAR_WEB_PORT` environment variable:
```bash
ANTIGRAVITY_SIDECAR_WEB_PORT=9000 python3 experimental/users/josemontesp/github_agent_loop/sidecars/dashboard/dashboard.py
```

### Sidecar Configuration

The sidecar config is located at `experimental/users/josemontesp/github_agent_loop/sidecars/dashboard/sidecar.json` and tells the orchestrator how to launch and display the dashboard inside the IDE's auxiliary pane.

## How to Start the Orchestrator

To start the orchestrator, prompt the agent with the following exact literal prompt:

"Please start the Github Agent orchestrator loop by loading the skill at: /google/src/files/head/depot/google3/experimental/users/josemontesp/github_agent_loop/skills/orchestrator/SKILL.md"
