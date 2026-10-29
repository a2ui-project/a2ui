#!/usr/bin/env python3
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Checks that the CI workflows of the repository run nightly on main.

Every workflow under .github/workflows/ that tests or validates the code must
run on a daily schedule, start on demand, keep pushes from cancelling its
scheduled run, and file an issue when its scheduled run fails. A workflow that
does not have to is listed in EXEMPT, with the reason. The SKILL.md next to
this directory describes each rule.

Usage:
  python3 check_workflows.py [--workflows-dir DIR]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any

import yaml

REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
)
DEFAULT_WORKFLOWS_DIR = os.path.join(REPO_ROOT, ".github", "workflows")

# Workflows that need not follow the rules, and why.
EXEMPT = {
    "e2e_test.yml": "runs nightly and files its own issues with the e2e_failure label",
    "run_evals.yml": (
        "runs nightly and files its own issues with the eval_failure label"
    ),
    "flutter_packages_test.yml": (
        "runs every hour, so an issue would get a comment every hour while"
        " the workflow stays broken"
    ),
    "pub_health.yml": (
        "checks the changelog of a pull request against its base branch, so"
        " a nightly run has nothing to check"
    ),
    "release-pypi.yml": "publishes packages and is not a test",
    "release-verify-pypi.yml": "checks a release and is not a test",
    "triage.yml": "labels issues and pull requests and is not a test",
    "weekly-audit.yml": "files a weekly compliance report and is not a test",
}

REPORT_JOB = "report-failure"
REPORT_IF = "failure() && github.event_name == 'schedule'"
REPORT_LABEL = "ci_failure"
FILTER_ACTION = "dorny/paths-filter@"
FILTER_IF = "github.event_name == 'push' || github.event_name == 'pull_request'"
DAILY_CRON = re.compile(r"^(\d{1,2}) (\d{1,2}) \* \* \*$")
CREATE_ISSUE = re.compile(
    r'\./scripts/create_issue\.sh "([^"]+)" "' + REPORT_LABEL + '"'
)


def load_workflow(path: str) -> dict[Any, Any]:
    with open(path, encoding="utf-8") as f:
        workflow = yaml.safe_load(f)
    if not isinstance(workflow, dict):
        raise ValueError(f"{path} is not a YAML mapping")
    return workflow


def triggers(workflow: dict[Any, Any]) -> dict[Any, Any]:
    # YAML 1.1 reads the key `on` as the boolean True.
    on = workflow.get("on", workflow.get(True))
    if isinstance(on, str):
        return {on: None}
    if isinstance(on, list):
        return {name: None for name in on}
    return on or {}


def ancestors(jobs: dict[str, Any], names: list[str]) -> set[str]:
    """Returns the jobs in `names` and every job they need, directly or not."""
    seen: set[str] = set()
    pending = list(names)
    while pending:
        name = pending.pop()
        if name in seen or name not in jobs:
            continue
        seen.add(name)
        needs = jobs[name].get("needs", [])
        pending.extend([needs] if isinstance(needs, str) else needs)
    return seen


def check_workflow(workflow: dict[Any, Any]) -> tuple[list[str], str | None]:
    """Checks one workflow.

    Returns:
      The problems found, and the cron expression of its schedule.
    """
    errors: list[str] = []
    on = triggers(workflow)

    cron = None
    schedule = on.get("schedule")
    if not schedule:
        errors.append("has no `schedule` trigger")
    elif len(schedule) != 1:
        errors.append("has more than one `schedule` cron; run it once a day")
    else:
        cron = schedule[0].get("cron", "")
        match = DAILY_CRON.match(cron)
        if not match:
            errors.append(f"cron {cron!r} is not once a day")
        elif int(match.group(1)) == 0:
            errors.append(
                f"cron {cron!r} starts on the hour, with the hourly Flutter CI run"
            )
    if "workflow_dispatch" not in on:
        errors.append("has no `workflow_dispatch` trigger")

    concurrency = workflow.get("concurrency")
    group = (
        concurrency.get("group", "")
        if isinstance(concurrency, dict)
        else concurrency or ""
    )
    if concurrency and "github.event_name" not in group:
        errors.append(
            "concurrency group does not include `github.event_name`, so a push"
            " cancels the scheduled run"
        )

    jobs: dict[str, Any] = workflow.get("jobs") or {}
    for job_name, job in jobs.items():
        for step in job.get("steps", []):
            if (
                FILTER_ACTION in str(step.get("uses", ""))
                and step.get("if") != FILTER_IF
            ):
                errors.append(
                    f"job `{job_name}` runs {FILTER_ACTION.rstrip('@')} without"
                    f" `if: {FILTER_IF}`, so a scheduled run filters on the last"
                    " commit"
                )

    report = jobs.get(REPORT_JOB)
    if report is None:
        errors.append(f"has no `{REPORT_JOB}` job")
        return errors, cron
    if report.get("if") != REPORT_IF:
        errors.append(f"job `{REPORT_JOB}` does not have `if: {REPORT_IF}`")
    needs = report.get("needs", [])
    needs = [needs] if isinstance(needs, str) else needs
    missed = set(jobs) - ancestors(jobs, needs) - {REPORT_JOB}
    if missed:
        errors.append(
            f"job `{REPORT_JOB}` does not wait for: {', '.join(sorted(missed))}"
        )
    permissions = report.get("permissions") or {}
    for scope, level in (("actions", "read"), ("issues", "write")):
        if permissions.get(scope) != level:
            errors.append(f"job `{REPORT_JOB}` lacks `{scope}: {level}` permission")
    if not any(
        CREATE_ISSUE.search(str(step.get("run", "")))
        for step in report.get("steps", [])
    ):
        errors.append(
            f'job `{REPORT_JOB}` does not run ./scripts/create_issue.sh "<name>"'
            f' "{REPORT_LABEL}"'
        )
    return errors, cron


def issue_name(workflow: dict[Any, Any]) -> str | None:
    report = (workflow.get("jobs") or {}).get(REPORT_JOB) or {}
    for step in report.get("steps", []):
        match = CREATE_ISSUE.search(str(step.get("run", "")))
        if match:
            return match.group(1)
    return None


def check_workflows(workflows_dir: str) -> list[str]:
    """Checks every workflow in `workflows_dir` and returns the problems."""
    errors: list[str] = []
    crons: dict[str, str] = {}
    names: dict[str, str] = {}
    for file_name in sorted(os.listdir(workflows_dir)):
        if not file_name.endswith((".yml", ".yaml")) or file_name in EXEMPT:
            continue
        workflow = load_workflow(os.path.join(workflows_dir, file_name))
        if "workflow_call" in triggers(workflow):
            # A reusable workflow runs as part of the workflow that calls it.
            continue
        file_errors, cron = check_workflow(workflow)
        errors.extend(f"{file_name}: {error}" for error in file_errors)
        if cron:
            if cron in crons:
                errors.append(
                    f"{file_name}: cron {cron!r} is the same as in {crons[cron]};"
                    " give each workflow a time of its own"
                )
            crons.setdefault(cron, file_name)
        name = issue_name(workflow)
        if name:
            if name in names:
                errors.append(
                    f"{file_name}: files issues as {name!r}, as {names[name]} does,"
                    " so their failures would share one issue"
                )
            names.setdefault(name, file_name)
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Checks that the CI workflows run nightly on main."
    )
    parser.add_argument("--workflows-dir", default=DEFAULT_WORKFLOWS_DIR)
    args = parser.parse_args(argv)
    errors = check_workflows(args.workflows_dir)
    for error in errors:
        print(f"::error::{error}")
    if errors:
        print(
            "\nSee .agents/skills/ci-workflows/SKILL.md for the rules, or add the"
            " workflow to EXEMPT in check_workflows.py with the reason."
        )
        return 1
    print("All CI workflows run nightly and report their failures.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
