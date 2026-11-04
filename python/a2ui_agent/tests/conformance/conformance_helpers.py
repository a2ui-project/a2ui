# Copyright 2024 Google LLC
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

"""Shared utility functions for A2UI conformance test harnesses."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import json
import os
from typing import Any

import pytest
import yaml

from ..repo_paths import find_repo_root


def get_conformance_path(filename: str) -> str:
    """Resolves a relative conformance file path against the top-level repository conformance directory.

    Args:
        filename: Relative file path within the conformance directory (e.g. 'agent/streaming_parser.yaml').

    Returns:
        Absolute filesystem path to the requested conformance file.

    Raises:
        FileNotFoundError: If the repository root or conformance file cannot be found.
    """
    root = find_repo_root()
    if not root:
        raise FileNotFoundError(
            f"Could not locate repository root for conformance file: {filename}"
        )
    return os.path.join(root, "conformance", filename)


def load_conformance_json(filename: str) -> Any:
    """Loads and parses a JSON file located in the conformance directory."""
    path = get_conformance_path(filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_conformance_yaml(filename: str) -> Any:
    """Loads and parses a YAML file located in the conformance directory."""
    path = get_conformance_path(filename)
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def case_params(
    suite: str,
    cases: Iterable[Any],
    skip: Mapping[str, str] | None = None,
    xfail: Mapping[str, str] | None = None,
) -> list[Any]:
    """Builds parameterized `(suite, case)` entries with skip and xfail markers."""
    params: list[Any] = []
    for case in cases:
        if isinstance(case, Mapping):
            case_id = str(case.get("id") or case.get("name"))
        else:
            case_id = str(getattr(case, "id", None) or getattr(case, "name", None))
        marks: list[pytest.MarkDecorator] = []
        if skip and case_id in skip:
            marks.append(pytest.mark.skip(reason=skip[case_id]))
        elif xfail and case_id in xfail:
            marks.append(pytest.mark.xfail(reason=xfail[case_id], strict=True))
        params.append(pytest.param(suite, case, marks=marks, id=case_id))
    return params


def assert_known_keys(
    obj: Mapping[str, Any],
    allowed: frozenset[str],
    where: str,
) -> None:
    """Fails the test if `obj` contains any keys not in `allowed`."""
    unknown = sorted(set(obj) - allowed)
    if unknown:
        pytest.fail(f"Unknown {where} keys: {unknown}")
