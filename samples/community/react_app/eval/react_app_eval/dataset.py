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

"""Loads the ReactApp and Express multi-line datasets on top of the eval runner's loader.

The datasets use the eval runner's schema (`eval/datasets/dataset_schema.json`)
plus one key of their own, `expect`, which holds the expectations of the
scorers in this package:

```yaml
expect:
  paths: [/loan/rate]          # the ReactApp must read or write each path
  functions: [formatCurrency]  # the ReactApp must call each function
  literals: ["const re = ..."] # each string must appear verbatim in the payload
  multiline: true              # the payload must hold a multi-line value
  allow_color_literals: true   # the app may hard-code colors (a color picker)
```

`expect` is removed before the runner's loader validates the file, and comes
back as `metadata["expect"]` of each sample.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
import tempfile
from typing import Any

from a2ui_eval.dataset import load_a2ui_dataset
from inspect_ai.dataset import MemoryDataset
import yaml

__all__ = ["DATASETS_DIR", "EXPECT_KEY", "load_dataset"]

DATASETS_DIR = Path(__file__).resolve().parent.parent / "datasets"
"""The encrypted datasets of this package."""

EXPECT_KEY = "expect"


def load_dataset(
    name: str,
    *,
    version: str = "1.0",
    format_name: str = "express",
    tags: str | Sequence[str] | None = None,
    datasets_dir: Path = DATASETS_DIR,
) -> MemoryDataset:
    """Loads `<datasets_dir>/<name>.yaml` as Inspect samples.

    Args:
        name: The dataset file name without `.yaml`.
        version: The protocol version.
        format_name: The inference format, which picks the runner's default
            role and workflow descriptions.
        tags: Tag(s) a sample must carry to be kept.
        datasets_dir: Where the dataset file lives.

    Returns:
        The samples, each with `metadata["expect"]` (empty when the sample has none).
    """
    path = datasets_dir / f"{name}.yaml"
    items: list[dict[str, Any]] = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    expectations = {
        item["name"]: item.pop(EXPECT_KEY, None) or {}
        for item in items
        if "name" in item
    }
    with tempfile.TemporaryDirectory() as tmp:
        stripped = Path(tmp) / path.name
        stripped.write_text(yaml.safe_dump(items, sort_keys=False), encoding="utf-8")
        dataset = load_a2ui_dataset(
            file_path=stripped,
            version=version,
            format_name=format_name,
            tags=tags,
        )
    for sample in dataset:
        assert sample.metadata is not None
        sample.metadata[EXPECT_KEY] = expectations.get(sample.metadata["name"], {})
    return dataset
