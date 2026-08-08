# Agent Instructions: Continuous Inference Format Optimization

You are an autonomous coding subagent tasked with systematically optimizing and improving an A2UI inference format (e.g., `atom`, `express`, `elemental`). Your goal is to maximize LLM generation pass rates (accuracy) while minimizing latency and token footprints.

---

## 🤖 Multi-Agent Subagent Worktree Protocol

When running iterative optimization cycles with subagents:

1. **Dedicated Worktree per Pass**: Each subagent MUST operate inside its own isolated Git worktree branch (`/usr/local/google/home/gspencer/code/a2ui/worktrees/opt-<format>-pass<N>`).
2. **Subagent Delegation**: The parent agent delegates each pass to a subagent (`invoke_subagent` with `TypeName="self"` and `Role="Express Pass N Optimizer"`).
3. **Sequential Execution**: Passes execute sequentially. The parent agent waits for the subagent's completion notification before launching the next pass.
4. **Automatic Guardrails & Archiving**:
   - The subagent tests code changes with `pytest`.
   - Runs `optimize_format.py --format <format>`.
   - Evaluates decision rules (KEEP if $S_{opt}$ improves and Pytest passes; REVERT if accuracy drops or output tokens expand $> +5\%$).
   - Archives the run into `eval/iterative_format_optimizer/history/<format>/` using `--archive`.
   - Runs `sync_history.py` to keep the master history summary up to date.

---

## Workspace Setup

Before making edits, spin up an isolated git worktree branch to run your experiments without conflicting with parallel agent runs or main code:

```bash
# Branch name convention: opt-<format>-<hypothesis_slug>[-<agent_id>]
# Directory convention: ../worktrees/<branch_name>
git worktree add ../worktrees/opt-atom-brackets -b opt-atom-brackets
```

Execute all subsequent steps inside that worktree directory.

---

## ⚡ Quick-Command Cheatsheet

Use these unified CLI commands to avoid writing custom Python scripts or manual archiving steps:

| Task                         | Unified Command                                                                                                                                                                                                                                        |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Test S-Expr Compilation**  | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format atom --compile "(Card (Text \"Hi\"))"`                                                                                            |
| **Test S-Expr AST Parsing**  | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format atom --parse "(Card (Text \"Hi\"))"`                                                                                              |
| **Test Decompilation**       | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format atom --decompile '{"version":"v1.0",...}'`                                                                                        |
| **Run Fast Subset Eval**     | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format atom`                                                                                                                             |
| **Run Targeted Prompt Eval** | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format atom --prompt loginForm`                                                                                                          |
| **Compare vs Baseline**      | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/compare_results.py --baseline eval/iterative_format_optimizer/baselines/atom/unbounded_run_meta.json eval/iterative_format_optimizer/logs/temp_optimization/` |
| **Archive Run (Atomic)**     | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format atom --archive --hypothesis "..." --status KEEP`                                                                                  |
| **Full Milestone Check**     | `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format atom --full`                                                                                                                      |

### 🚫 Anti-Patterns & Operational Guardrails

1. **DO NOT write ad-hoc `python -c` scripts** to import `AtomCompiler` or test S-expressions. Use `--compile` or `--parse` instead.
2. **DO NOT run manual 5-step shell archiving dances** (`mkdir`, `cp`, `git diff > patch.diff`). Use `optimize_format.py --archive` instead.
3. **DO NOT retry backtracked hypotheses**. Always check `eval/iterative_format_optimizer/history_summary.md` first.

---

## The Optimization Loop

For each iteration, perform the following steps:

### Step 1: Analyze History & Formulate Hypothesis

1. **Check Historical Index & Past Runs**: Read `eval/iterative_format_optimizer/history_summary.md` and scan recent `run_meta.json` files in `eval/iterative_format_optimizer/history/` to inspect all previous experiments, their hypotheses, status (`KEEP` vs `REVERT`), and code diffs.
2. **Anti-Repetition Constraint**: **DO NOT** repeat or retry a hypothesis, prompt rule edit, or code modification that was already tested and reverted in a past run.
3. **Analyze Failure Patterns**: Review baseline failure logs in `eval/baselines/{format}/results.json` to identify unresolved failure patterns (e.g. nested layout errors, dangling string references, missing optional attributes).
4. **Formulate a Minimal Hypothesis**: State a specific, targeted hypothesis (e.g. "Replacing positional parameter placeholders with explicit keyword syntax will eliminate container nesting ambiguity").

### Step 2: Implement and Verify Code

1. Implement changes in:
   - System prompts and format rules: `agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/{format}/prompt_generator.py` (or prompt template files).
   - Parser, compiler, or decompiler code: under `agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/{format}/`.
2. **Catalog Agnosticism Constraint (Strict Non-Negotiable)**:
   - All compilers, decompilers, prompt generators, and system prompt instruction templates MUST remain 100% catalog-agnostic.
   - **NO Hardcoded Component or Property Names in Code**: Compilers and decompilers MUST NOT hardcode specific component names (e.g. `Card`, `Column`, `Row`, `List`, `Button`) or catalog-specific property names (e.g. `children`, `child`, `trigger`, `content`, `template`, `items`) in parsing/compilation decision trees.
   - **NO Catalog-Specific Prompt Rules or Examples**: System prompt instruction blocks (e.g. `ATOM_RULES`, `EXPRESS_RULES`, `ELEMENTAL_RULES`) and generated examples MUST NOT assume or hardcode rules/examples specific to individual basic catalog components or properties (e.g. referencing `Image`, `Text`, `:url`, `:src`, `variant`, `"caption"`, `"body"`). Instructions must remain format-grammar-centric using generic syntax placeholders (`(ComponentName :key val child1 ...)`).
   - **Dynamic Schema Inspection**: Compilers/decompilers and prompt generators MUST inspect catalog schema `$ref` types (e.g. `https://a2ui.org/specification/v0_9/common_types.json#/$defs/ChildList`, `https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentId`, `https://a2ui.org/specification/v0_9/common_types.json#/$defs/Action`) and generate signatures dynamically via `CatalogSchemaHelper`.
   - **Synthetic Catalog Verification**: All compiler/decompiler/prompt changes MUST pass the fuzzed synthetic catalog unit test (`test_fuzzed_synthetic_catalog_agnosticism`) to prove they function on custom or fuzzed catalogs.
3. Run pytest conformance unit tests locally first:
   ```bash
   uv run pytest agent_sdks/python/a2ui_agent/tests/
   ```
4. If unit tests fail, classify the failure:
   - **Prompt-Only Regression**: If only prompt/template files were modified and unit tests fail, it is a prompt regression. You **MUST** immediately revert the prompt modification.
   - **Parser/Compiler Regression**: A change broke existing valid compiler behavior. You **must** fix the compiler code or revert the change.
   - **Format Capability Evolution**: The compiler was deliberately modified to support new/updated syntax, causing old tests to fail. You **must** update the unit tests under `agent_sdks/python/a2ui_agent/tests/{format}/` to match and cover the new capability.

### Step 3: Run the Evaluation

Run the orchestrator script to compile the metrics and generate the current diagnostic report. By default, this runs on a small-scale validation subset of 5 diverse prompts to minimize cost and execution time:

```bash
uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format <format> --model <model>
```

_Note: For targeted debugging of a specific failure, you can run:_

```bash
uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format <format> --model <model> --prompt <prompt_name>
```

### Step 4: Evaluate Metrics & Compare Against Baseline

Run `compare_results.py` to compare your current run directory against the baseline directory (`eval/iterative_format_optimizer/baselines/<format>`). By default, it computes median metrics:

```bash
uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/compare_results.py --baseline eval/iterative_format_optimizer/baselines/<format>/unbounded_run_meta.json <current_run_dir_or_eval_log>
```

_(To inspect mean averages instead of default medians, pass `--average`)_.

Analyze the generated Markdown table and Metric Definitions Key:

1. **Pytest Conformance**: Must be `PASS`.
2. **Correctness Guardrails**:
   - `Schema Acc (Delta)`: Percentage of outputs passing strict compiler syntax and schema validation (`a2ui_scorer`).
   - `Quality Score (Delta)`: LLM-graded semantic intent accuracy score (`measured_model_graded_qa`).
3. **Efficiency Optimization Metrics**:
   - `Median Code Output Tok (Delta)`: Token count of generated code. Direct target of format design optimization.
   - `Non-reasoning Output Time (Median)`: Estimated time spent emitting code. Shrinks proportionally with code output tokens.
   - `Median Input Tok (Delta)`: System prompt and catalog schema token size. Lower input tokens prevent API throttling.
   - `Parallel Wall Latency (Delta)`: Batch wall-clock throughput under 10 concurrent tasks.

### Step 5: Progression or Rollback Decision

Evaluate your iteration against these 4 decision rules:

1. **Rule 1 (Correctness Guardrail - Non-negotiable)**: `Schema Acc` and `Quality Score` **MUST NOT** regress below Baseline.
   - _If Accuracy Degrades_ $\rightarrow$ You **MUST** immediately roll back the changes using `uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format <format> --revert`.

2. **Rule 2 (Efficiency Regression Caps - Non-negotiable)**: Even if accuracy remains equal or 100%, you **MUST REVERT** if:
   - `Median Code Output Tok` increases by **> 5%** vs baseline/previous run.
   - `Non-reasoning Output Time` (streaming latency) increases by **> 10%** vs baseline/previous run.
   - `Median Reasoning Tok` increases by **> 15%** vs baseline/previous run (prevents prompt instruction search space ambiguity).

3. **Rule 3 (Composite Optimization Score $S_{\text{opt}}$)**:
   - Check `Score (S_opt)` in the comparison table:
     $$S_{\text{opt}} = 0.50 \times \text{SchemaAcc} + 0.30 \times \text{QualityScore} - 0.15 \times \left(\frac{\text{CodeTok}}{\text{BaseCodeTok}}\right) - 0.05 \times \left(\frac{\text{ReasonTok}}{\text{BaseReasonTok}}\right) - 0.03 \times \left(\frac{\text{InputTok}}{\text{BaseInputTok}}\right)$$
   - _If $S_{\text{opt}}(\text{Current}) > S*{\text{opt}}(\text{Baseline})$* $\rightarrow$ **KEEP CHANGE**.
   - _If $S_{\text{opt}}(\text{Current}) \le S*{\text{opt}}(\text{Baseline})$* $\rightarrow$ **REVERT CHANGE** (`uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format <format> --revert`).

### Step 6: Archive Iteration Run

To save the historical run context for future analysis and allow the orchestrator to automatically maintain the summary index:

1. Determine the next run index (e.g. `run_003`).
2. Create the run folder:
   ```bash
   # Directory naming: run_<three_digit_index>_<commit_sha>_<slugified_summary>
   mkdir -p eval/iterative_format_optimizer/history/<format>/run_003_a8f9c1b_fix_brackets
   ```
3. Archive logs and files:
   - Copy report: `cp eval/iterative_format_optimizer/current_report.md eval/iterative_format_optimizer/history/<format>/run_003_a8f9c1b_fix_brackets/report.md`
   - Copy results log: `cp eval/iterative_format_optimizer/logs/temp_optimization/results.json eval/iterative_format_optimizer/history/<format>/run_003_a8f9c1b_fix_brackets/results.json`
   - Generate diff patch: `git diff > eval/iterative_format_optimizer/history/<format>/run_003_a8f9c1b_fix_brackets/patch.diff`
4. Write `run_meta.json` folder metadata detailing your hypothesis and annotations:
   ```json
   {
     "hypothesis": "Description of proposed fix",
     "notes": "Qualitative summary of results / failures",
     "status": "Kept" (or "Backtracked")
   }
   ```
5. Commit the code and the archived folder local to your branch.

---

## Verification, History Synchronization & Two-Tiered Merging

1. **Tier 1: Subagent Fast Inner Loop (Validation Subset)**: Subagents execute rapid hypothesis iterations using the fast validation subset. When a run meets decision rules (`KEEP`), the subagent archives the run and commits its branch as a **Milestone Candidate**.
2. **Synchronizing Multi-Worktree History**: Collect history across parallel agent worktrees into main history:
   ```bash
   uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/sync_history.py
   ```
3. **Tier 2: Outer-Loop Milestone Full Suite Check**: Before merging a Milestone Candidate branch into `main`, execute full suite verification across all evaluation samples:
   ```bash
   uv run python eval/iterative_format_optimizer/skills/inference-format-optimizer/scripts/optimize_format.py --format <format> --model <model> --full
   ```
4. **PR Creation & Merging**: Create a Pull Request to merge your worktree branch back to the main repository. When branches are merged, the history run folders merge conflict-free. Future agents starting from `main` will automatically inherit the complete collective history of all previous runs.

---

## Termination Triggers

Stop your execution loop and report results to the human operator when:

1. **Target Achieved**: 100% pass rate is achieved on the full suite.
2. **Plateau**: No accuracy improvements are observed after 3 consecutive iterations with different hypotheses.
3. **Max Iterations**: You have completed 10 runs.
4. **Stuck / Blocked**: If you encounter an infrastructure error or a requirement conflict that prompt/compiler tuning cannot fix, halt and ask for help.
