# A2UI Iterative Format Optimization Framework

This directory contains tools for iteratively evaluating, benchmarking, and optimizing alternative A2UI inference formats (such as Atom, Express, and Elemental) against baseline standards.

## Overview

The iterative optimization workflow automates format testing, metric calculation, history archiving, and cross-worktree run synchronization.

Key capabilities include:

- **Format Compilation & Validation**: Test parsing, compilation, and decompilation of custom inference format payloads.
- **Automated Metric Extraction**: Compute schema accuracy, model-graded quality pass rates, token usage, and latency.
- **Composite Score Calculation ($S_{opt}$)**: Evaluate trade-offs between accuracy and token efficiency against baseline runs.
- **Atomic Run Archiving**: Preserve run logs, metrics, patch diffs, and hypotheses in `history/`.
- **Cross-Worktree Synchronization**: Merge archived runs from parallel git worktrees without run ID collisions.

## Key Scripts

### 1. `optimize_format.py`

Main orchestrator script for running format optimization loops.

```bash
# Run format optimization on standard evaluation subset
uv run python optimize_format.py --format atom

# Run quick 2-sample sanity check
uv run python optimize_format.py --format atom --sanity

# Run full evaluation suite
uv run python optimize_format.py --format atom --full

# Save current run as baseline for format
uv run python optimize_format.py --format atom --save-baseline

# Archive run results with hypothesis and decision status
uv run python optimize_format.py --format atom --archive --hypothesis "Simplified S-expression syntax" --status KEEP --notes "Passed unit tests"
```

### 2. `compare_results.py`

Compares evaluation runs against a baseline and generates GitHub Flavored Markdown comparison tables.

```bash
# Compare a target run directory against baseline
uv run python compare_results.py --baseline eval/baselines/atom/unbounded/ eval/history/atom/run_015_e4394473_simplified_s_expression/

# Save markdown report to file
uv run python compare_results.py --baseline eval/baselines/atom/unbounded/ eval/history/atom/run_015_e4394473_simplified_s_expression/ --output comparison.md
```

### 3. `sync_history.py`

Synchronizes archived history run directories across parallel git worktrees into a single unified history index.

```bash
# Auto-detect and sync sibling worktree histories
uv run python sync_history.py

# Sync specific worktree directory
uv run python sync_history.py -w ../worktrees/atom_branch
```

## Directory Structure

- **`history/`**: Archived optimization run directories containing `run_meta.json`, `patch.diff`, `report.md`, and `results.json`.
- **`history_summary.md`**: Master index table listing all archived runs across worktrees.
- **`utils/`**: Core helper utilities:
  - **`archiver.py`**: Atomic archiving logic.
  - **`format_tools.py`**: Snippet compiler and decompiler helpers.
  - **`reporter.py`**: Markdown report generator.
  - **`runner.py`**: Subprocess runners for `pytest` and Inspect AI evaluations.

## Composite Score ($S_{opt}$) Formula

The composite optimization score $S_{opt}$ balances accuracy and token efficiency against a baseline run:

\[
S\_{opt} = 0.50 \cdot \text{SchemaAcc} + 0.30 \cdot \text{QualityScore} - 0.15 \cdot \frac{\text{CodeTok}}{\text{BaseCodeTok}} - 0.05 \cdot \frac{\text{ReasonTok}}{\text{BaseReasonTok}} - 0.03 \cdot \frac{\text{InputTok}}{\text{BaseInputTok}}
\]
