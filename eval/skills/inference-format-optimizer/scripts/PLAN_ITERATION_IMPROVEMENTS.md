# Plan: Iterative Optimization Pipeline Improvements

## Executive Summary

Analysis of over 4,300 terminal execution calls and 170+ subagent transcripts across 52 serial optimization runs revealed clear operational friction patterns:

1. **Ad-hoc Python One-Liners (140+ instances)**: Subagents repeatedly wrote multi-line inline Python scripts (`python -c "from a2ui.inference_formats.experimental.atom import AtomCompiler..."`) to test whether candidate S-expressions compiled cleanly or to inspect AST node outputs.
2. **Manual Archiving Overhead (5-step shell dance)**: Every run required subagents to manually `mkdir` run folders, run `git diff`, generate `run_meta.json`, copy `current_report.md`, and invoke `sync_history.py`.
3. **Reasoning Overhead in Prompt Rules**: Subagents spent unnecessary context tokens determining CLI invocations or navigating past experiment histories.

This plan details 3 key improvements to codify these patterns, increase subagent reliability, reduce token consumption, and accelerate optimization loop velocity.

---

## 1. CLI Quick-Compiler & Diagnostic Tooling (`optimize_format.py`)

### 1.1 `--compile` / `--test-snippet` Flag

Add a quick-compiler interface directly to `optimize_format.py` so agents can test S-expression compilation in 1 simple command:

```bash
uv run python eval/iterative/optimize_format.py --format atom --compile "(Card (Column (Text \"Hello\")))"
```

- **Output**: Formatted JSON payload produced by `AtomCompiler` (or `ExpressCompiler`/`ElementalCompiler`), or clear syntax error tracebacks if invalid.

### 1.2 `--decompile` Flag

Add a quick-decompiler interface:

```bash
uv run python eval/iterative/optimize_format.py --format atom --decompile '{"version":"v1.0","createSurface":{...}}'
```

- **Output**: Decompiled S-expression string.

### 1.3 `--parse` / `--ast` Flag

Add an AST parser node inspector interface:

```bash
uv run python eval/iterative/optimize_format.py --format atom --parse "(Card (Column (Text \"Hello\")))"
```

- **Output**: Pretty-printed Python/JSON representation of the parsed AST node tree (`ComponentNode`, `FunctionCallNode`, etc.), allowing agents to debug parser logic directly without compiling to final JSON.

---

## 2. Automated Single-Command Archiving (`optimize_format.py --archive`)

### 2.1 `--archive` Integration

Codify the entire 5-step run archiving workflow into a single atomic command:

```bash
uv run python eval/iterative/optimize_format.py --format atom \
  --archive \
  --hypothesis "Compiler-side dynamic event handler context parameter normalization" \
  --status KEEP \
  --notes "Pytest 100% pass. Code tok -14.9%, S_opt +0.027."
```

### 2.2 Automated Execution Steps of `--archive`:

1. Determines next sequential run ID (e.g. `run_053`).
2. Slugifies the hypothesis into a directory name (`run_053_<sha>_<slug>`).
3. Generates `patch.diff` via `git diff`.
4. Copies `current_report.md` to `report.md`.
5. Extracts run metrics and writes `run_meta.json` with aggregate + per-sample metrics.
6. Invokes `sync_history.py` to regenerate `history_summary.md`.

---

## 3. Updated Subagent Instructions (`agent_instructions.md`)

### 3.1 "One-Command Cheatsheet" Section

Add a prominent quick-reference section at the top of `agent_instructions.md`:

| Action                      | Command                                                                                                       |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------ |
| **Test S-Expr Compilation** | `uv run python eval/iterative/optimize_format.py --format atom --compile "(Card (Text \"Hi\"))"`              |
| **Run Fast Evaluation**     | `uv run python eval/iterative/optimize_format.py --format atom`                                               |
| **Run Targeted Prompt**     | `uv run python eval/iterative/optimize_format.py --format atom --prompt loginForm`                            |
| **Compare vs Baseline**     | `uv run python eval/iterative/compare_results.py --baseline eval/baselines/atom eval/logs/temp_optimization/` |
| **Archive Run (Atomic)**    | `uv run python eval/iterative/optimize_format.py --format atom --archive --hypothesis "..." --status KEEP`    |
| **Full Milestone Check**    | `uv run python eval/iterative/optimize_format.py --format atom --full`                                        |

### 3.2 Anti-Patterns & Operational Guardrails

- **Anti-Pattern 1**: Writing ad-hoc `python -c` scripts to import `AtomCompiler`. (Use `--compile` instead).
- **Anti-Pattern 2**: Manual `mkdir` / `cp` / `git diff` shell sequences for archiving. (Use `--archive` instead).
- **Anti-Pattern 3**: Re-running backtracked hypotheses. (Check `history_summary.md` status `Backtracked` list first).

---

## 4. Modular Refactoring of `optimize_format.py`

To prevent `optimize_format.py` (currently ~670 lines) from becoming a monolithic "kitchen sink", we will refactor its responsibilities into dedicated utility modules under `eval/iterative/utils/`:

```
eval/iterative/
├── optimize_format.py           # Clean CLI orchestrator & argument parser (~150 lines)
├── compare_results.py           # Metric comparison & delta table generator
├── sync_history.py              # Master index & history summary synchronizer
└── utils/                       # Shared helper utilities
    ├── __init__.py
    ├── runner.py                # Pytest and Inspect evaluation subprocess runners
    ├── reporter.py              # Markdown report generation & log parsing
    ├── archiver.py              # Atomic run archiving (patch.diff, run_meta.json, history sync)
    └── format_tools.py          # Quick-compiler & decompiler interfaces (--compile / --decompile)
```

### Module Responsibilities

1. **`utils/runner.py`**: Encapsulates `run_unit_tests()`, `run_evaluation()`, `load_log_data()`, and `get_git_diff()`.
2. **`utils/reporter.py`**: Encapsulates `generate_optimization_report()` and `extract_metrics_from_log()`.
3. **`utils/archiver.py`**: Encapsulates `--archive` logic (`patch.diff`, `run_meta.json`, directory creation, `sync_history` dispatch).
4. **`utils/format_tools.py`**: Encapsulates `--compile` and `--decompile` helper logic across formats (`atom`, `express`, `elemental`).
5. **`optimize_format.py`**: Lightweight CLI dispatcher (<150 lines) maintaining 100% backward-compatible CLI args.

---

## 5. Implementation Schedule

1. **Phase 1**: Extract `eval/iterative/utils/` submodules (`runner.py`, `reporter.py`, `format_tools.py`).
2. **Phase 2**: Add `--compile` and `--decompile` flags to `format_tools.py`.
3. **Phase 3**: Add `--archive` flag to `archiver.py`.
4. **Phase 4**: Update `agent_instructions.md` with the "One-Command Cheatsheet" and anti-patterns.
5. **Phase 5**: Add unit tests in `eval/tests/` verifying submodules and CLI flags.
