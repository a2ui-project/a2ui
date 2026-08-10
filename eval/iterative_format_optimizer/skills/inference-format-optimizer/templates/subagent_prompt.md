You are tasked with executing Optimization Pass {{PASS_NUM}} on the {{FORMAT}} inference format in the dedicated worktree:
Directory: {{WORKTREE_PATH}}

Task instructions:

1. Edit file: {{TARGET_FILE}}
   Hypothesis: {{HYPOTHESIS}}

2. Run Pytest unit tests:
   PYTHONPATH=agent_sdks/python/a2ui_agent/src:agent_sdks/python/a2ui_core/src /usr/local/google/home/gspencer/code/a2ui/iterative_optimization/.venv/bin/python -m pytest agent_sdks/python/a2ui_agent/tests/{{FORMAT}}/

3. Run optimization evaluation:
   /usr/local/google/home/gspencer/code/a2ui/iterative_optimization/.venv/bin/python eval/iterative/optimize_format.py --format {{FORMAT}}

4. Decision rules:
   - If unit tests fail, Quality Score regresses below baseline, or Output Tokens expand by > 5%:
     Revert changes using `git reset --hard HEAD` and archive the run:
     /usr/local/google/home/gspencer/code/a2ui/iterative_optimization/.venv/bin/python eval/iterative/optimize_format.py --format {{FORMAT}} --archive --hypothesis "Pass {{PASS_NUM}}: {{HYPOTHESIS}}" --status REVERT --notes "<reason>"
   - Else keep the changes and archive with --status KEEP.

5. Run history sync:
   /usr/local/google/home/gspencer/code/a2ui/iterative_optimization/.venv/bin/python eval/iterative/sync_history.py

Provide a summary of the outcome when complete.
