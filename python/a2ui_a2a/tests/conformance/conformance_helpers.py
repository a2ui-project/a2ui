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

import json
import os
from typing import Any

import yaml


def find_repo_root() -> str | None:
    """Returns the first ancestor of this file that has a `specification` directory."""
    current = os.path.dirname(os.path.abspath(__file__))
    while True:
        if os.path.isdir(os.path.join(current, "specification")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


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
