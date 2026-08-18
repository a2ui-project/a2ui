---
name: inference-format-optimizer
description: Iterative benchmarking, evaluation, and algorithmic optimization of alternative A2UI inference formats (such as Express, Atom, and Elemental). Trigger when asked to: (1) Run optimization passes or loops on an inference format, (2) Evaluate or benchmark format accuracy, latency, or token efficiency, (3) Create parallel worktree subagents for format iteration, or (4) Benchmark format trade-offs against baselines.
---

# Inference Format Optimizer

This skill provides procedural workflows, CLI orchestrators, decision guardrails, and subagent protocols for iteratively optimizing A2UI inference formats.

---

## Quick-Start CLI Cheatsheet

All execution scripts live under `scripts/` in this skill:

| Action                          | Executable Command                                                                                                                                                                |
| :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run Fast Validation Eval**    | `python scripts/optimize_format.py --format <format>`                                                                                                                             |
| **Run Full Evaluation Suite**   | `python scripts/optimize_format.py --format <format> --full`                                                                                                                      |
| **Test Parsing / Compilation**  | `python scripts/optimize_format.py --format <format> --compile "(Card (Text \"Hi\"))"`                                                                                            |
| **Compare vs Baseline**         | `python scripts/compare_results.py --baseline eval/iterative_format_optimizer/baselines/<format>/unbounded_run_meta.json eval/iterative_format_optimizer/logs/temp_optimization/` |
| **Archive Run Artifacts**       | `python scripts/optimize_format.py --format <format> --archive --hypothesis "..." --status KEEP [--history-dir <path>]`                                                           |
| **Sync Multi-Worktree History** | `python scripts/sync_history.py [--history-dir <path>]`                                                                                                                           |

---

## Detailed References

- **Scoring & Decision Rules**: See [references/scoring_model.md](references/scoring_model.md) for $S_{\text{opt}}$ formula, correctness guardrails, and efficiency caps.
- **Subagent Worktree Protocol**: See [references/subagent_protocol.md](references/subagent_protocol.md) for launching subagents in isolated git worktrees.
- **Subagent Prompt Template**: See [templates/subagent_prompt.md](templates/subagent_prompt.md) for launching pass tasks via `invoke_subagent`.

---

## The 6-Step Optimization Workflow

1. **Analyze History**: Inspect past runs in `eval/iterative_format_optimizer/history/<format>/` and read `eval/iterative_format_optimizer/history_summary.md` to avoid repeating past reverted hypotheses.
2. **Implement Hypothesis**: Modify `compiler.py`, `prompt_generator.py`, or `parser.py` under `agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/<format>/`.
3. **Run Unit Conformance Tests**: Verify code changes pass pytest unit tests.
4. **Execute Benchmark Evaluation**: Run `python scripts/optimize_format.py --format <format>`.
5. **Evaluate Decision Rules**:
   - Must pass Pytest and maintain baseline accuracy.
   - Code Output Tokens must NOT expand $> +5\%$.
   - Keep change if composite score $S_{\text{opt}}$ improves; revert otherwise (`git reset --hard HEAD`).
6. **Archive & Synchronize**: Archive run with `--archive` and update history index using `python scripts/sync_history.py`.
