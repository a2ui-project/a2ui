# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Runs the suites and writes a pass-rate report.

```bash
uv run python -m react_app_eval.run --suite all --epochs 3
```
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
import json
from pathlib import Path
import re
from typing import Any

from inspect_ai import Task, eval as inspect_eval
from inspect_ai.log import EvalLog, EvalSample

from .tasks import DEFAULT_MODEL, express_multiline_v1_0, react_app_v1_0

__all__ = ["SuiteReport", "main", "summarize"]

_SUITES = {"react_app": react_app_v1_0, "express": express_multiline_v1_0}
_SUITE_SCORERS = {
    "react_app_v1_0": "react_app_scorer",
    "express_multiline_v1_0": "express_multiline_scorer",
}
_DEFAULT_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"


@dataclass
class SuiteReport:
    """Pass rates and failure modes of one suite."""

    suite: str
    samples: int = 0
    epochs: int = 0
    stage12: float = 0.0
    checks: dict[str, float] = field(default_factory=dict)
    judge: dict[str, int] = field(default_factory=dict)
    passed: float = 0.0
    passed_per_epoch: dict[int, float] = field(default_factory=dict)
    per_sample: dict[str, float] = field(default_factory=dict)
    failure_modes: list[tuple[str, int]] = field(default_factory=list)

    def to_markdown(self) -> str:
        lines = [
            f"### {self.suite}",
            "",
            (
                f"{self.samples} samples x {self.epochs} runs. A sample passes when"
                " Stage 1/2 pass, every hard check of the suite passes, and the judge"
                " grades it C."
            ),
            "",
            "| Metric | Pass rate |",
            "| --- | --- |",
            f"| Overall pass | {self.passed:.0%} |",
            *(
                f"| Run {epoch} pass | {rate:.0%} |"
                for epoch, rate in sorted(self.passed_per_epoch.items())
            ),
            f"| Stage 1/2 (valid A2UI + assertions) | {self.stage12:.0%} |",
            *(f"| Check: {key} | {rate:.0%} |" for key, rate in self.checks.items()),
            (
                f"| Judge C / P / I | {self.judge.get('C', 0)} /"
                f" {self.judge.get('P', 0)} / {self.judge.get('I', 0)} |"
            ),
            "",
            "| Sample | Pass rate |",
            "| --- | --- |",
            *(
                f"| {name} | {rate:.0%} |"
                for name, rate in sorted(self.per_sample.items())
            ),
            "",
            "Top failure modes:",
            "",
            *(
                f"{i}. {mode} ({count})"
                for i, (mode, count) in enumerate(self.failure_modes, 1)
            ),
        ]
        return "\n".join(lines)


def _score_value(sample: EvalSample, name: str) -> Any:
    score = (sample.scores or {}).get(name)
    return None if score is None else score.value


def _explanation(sample: EvalSample, name: str) -> str:
    score = (sample.scores or {}).get(name)
    return (score.explanation or "") if score is not None else ""


def _failure_mode(text: str) -> str:
    """Shortens an explanation to a countable category."""
    text = text.strip().splitlines()[0] if text.strip() else "unknown"
    text = re.sub(r"\d+", "N", text)
    text = re.sub(r"'[^']*'|\"[^\"]*\"", "…", text)
    return text[:140]


def _rate(values: Sequence[float | bool]) -> float:
    return sum(float(v) for v in values) / len(values) if values else 0.0


def summarize(log: EvalLog) -> SuiteReport:
    """Builds the report of one suite's eval log."""
    suite = str((log.eval.metadata or {}).get("suite") or log.eval.task)
    suite_scorer = _SUITE_SCORERS.get(suite, "")
    samples: Sequence[EvalSample] = log.samples or []
    report = SuiteReport(suite=suite)
    if not samples:
        return report
    report.samples = len({s.id for s in samples})
    report.epochs = max(s.epoch for s in samples)
    passes_by_sample: dict[str, list[bool]] = defaultdict(list)
    passes_by_epoch: dict[int, list[bool]] = defaultdict(list)
    check_values: dict[str, list[float]] = defaultdict(list)
    judge: Counter[str] = Counter()
    failures: Counter[str] = Counter()
    stage12: list[bool] = []
    for sample in samples:
        stage_ok = _score_value(sample, "a2ui_scorer") == 1.0
        stage12.append(stage_ok)
        checks = _score_value(sample, suite_scorer) or {}
        for key, value in checks.items():
            check_values[key].append(float(value))
        grade = str(_score_value(sample, "measured_model_graded_qa") or "I")
        judge[grade] += 1
        ok = stage_ok and float(checks.get("all", 0)) == 1.0 and grade == "C"
        passes_by_sample[str(sample.metadata.get("name") or sample.id)].append(ok)
        passes_by_epoch[sample.epoch].append(ok)
        if not stage_ok:
            failures[
                f"Stage 1/2: {_failure_mode(_explanation(sample, 'a2ui_scorer'))}"
            ] += 1
        elif float(checks.get("all", 0)) != 1.0:
            for part in _explanation(sample, suite_scorer).split("; "):
                failures[f"Check: {_failure_mode(part)}"] += 1
        elif grade != "C":
            failures[f"Judge {grade}"] += 1
        if checks and float(checks.get("typechecks", 1)) != 1.0:
            failures["(soft) TypeScript errors"] += 1
    report.stage12 = _rate(stage12)
    report.checks = {key: _rate(values) for key, values in check_values.items()}
    report.judge = dict(judge)
    report.passed = _rate([ok for oks in passes_by_sample.values() for ok in oks])
    report.passed_per_epoch = {
        epoch: _rate(oks) for epoch, oks in passes_by_epoch.items()
    }
    report.per_sample = {name: _rate(oks) for name, oks in passes_by_sample.items()}
    report.failure_modes = failures.most_common(8)
    return report


def _tasks(suites: Iterable[str], args: argparse.Namespace) -> list[Task]:
    return [
        _SUITES[suite](
            grading_model=args.grading_model,
            no_judge=args.no_judge,
            tags=args.tags,
            max_validation_retries=args.max_validation_retries,
        )
        for suite in suites
    ]


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=[*_SUITES, "all"], default="all")
    parser.add_argument("--epochs", type=int, default=3, help="Runs of every sample.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--grading-model", default=DEFAULT_MODEL)
    parser.add_argument("--no-judge", action="store_true")
    parser.add_argument("--tags", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--max-connections", type=int, default=10)
    parser.add_argument("--max-validation-retries", type=int, default=0)
    parser.add_argument("--log-dir", type=Path, default=_DEFAULT_LOG_DIR)
    args = parser.parse_args(argv)

    suites = list(_SUITES) if args.suite == "all" else [args.suite]
    logs = inspect_eval(
        _tasks(suites, args),
        model=args.model,
        epochs=args.epochs,
        limit=args.limit,
        log_dir=str(args.log_dir),
        max_connections=args.max_connections,
        display="plain",
    )
    reports = [summarize(log) for log in logs]
    markdown = "\n\n".join(report.to_markdown() for report in reports)
    print(markdown)
    args.log_dir.mkdir(parents=True, exist_ok=True)
    (args.log_dir / "report.md").write_text(markdown + "\n", encoding="utf-8")
    (args.log_dir / "report.json").write_text(
        json.dumps([report.__dict__ for report in reports], indent=2, default=str)
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
