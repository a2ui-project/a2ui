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

from __future__ import annotations

from collections.abc import Sequence
import glob
import json
import logging
import os
from urllib.parse import urlparse

from a2ui.core import A2uiCatalogError, A2uiError, CatalogApi
from a2ui.utils import validate_payload

from .constants import ENCODING


def resolve_examples_path(path: str | None) -> str | None:
    if path:
        parsed = urlparse(path)
        if not parsed.scheme or parsed.scheme == "file":
            return parsed.path
        else:
            raise A2uiCatalogError(f"Unsupported examples URL scheme: {path}")
    return None


def load_examples(
    catalogs: Sequence[CatalogApi], path: str | None, validate: bool = False
) -> str:
    """Loads few-shot examples from a directory or a glob pattern.

    Args:
      catalogs: The catalogs that the examples are validated against. Each
        surface is checked against the catalog its `catalogId` names, so pass
        every catalog that the examples use.
      path: A directory of `.json` files, or a glob pattern.
      validate: Whether to check each example with
        `a2ui.utils.validate_payload`.

    Returns:
      The examples, each between `---BEGIN <name>---` and `---END <name>---`
      lines, or an empty string if there are none.

    Raises:
      A2uiCatalogError: If `validate` is set and an example isn't valid JSON or
        fails validation.
    """
    if not path:
        return ""

    # If it's a directory, support backward compatibility by appending /*.json
    if os.path.isdir(path):
        pattern = os.path.join(path, "*.json")
    else:
        pattern = path

    # Use glob to find files
    matched_files = glob.glob(pattern, recursive=True)

    if not matched_files:
        if not os.path.isdir(path) and not any(c in path for c in "*?[]"):
            logging.warning(
                f"Example path {path} is neither a directory nor a valid glob pattern"
            )
        return ""

    # Sort for determinism
    matched_files.sort()

    merged_examples = []
    for full_path in matched_files:
        if not os.path.isfile(full_path):
            continue
        basename = os.path.splitext(os.path.basename(full_path))[0]
        with open(full_path, "r", encoding=ENCODING) as f:
            content = f.read()

        if validate:
            try:
                json_data = json.loads(content)
                validate_payload(catalogs, json_data)
            except (json.JSONDecodeError, A2uiError) as e:
                raise A2uiCatalogError(
                    f"Failed to validate example {full_path}: {e}"
                ) from e

        merged_examples.append(
            f"---BEGIN {basename}---\n{content}\n---END {basename}---"
        )

    if not merged_examples:
        return ""
    return "\n\n".join(merged_examples)
