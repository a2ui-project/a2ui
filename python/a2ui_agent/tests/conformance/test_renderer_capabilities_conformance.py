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

"""Conformance runner for `conformance/agent/renderer_capabilities.yaml`."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.core import A2uiCatalogError
from a2ui.core import A2uiValidationError
from a2ui.utils import read_renderer_capabilities

from .conformance_helpers import assert_known_keys
from .conformance_helpers import case_params
from .conformance_helpers import load_conformance_yaml

_SUITE = "agent/renderer_capabilities.yaml"
_CASE_KEYS = frozenset({
    "name",
    "description",
    "features",
    "action",
    "args",
    "expect",
    "expect_error",
})
_EXPECT_ERROR_KEYS = frozenset({"category", "message"})
_ERROR_CATEGORIES: dict[str, type[Exception]] = {
    "CatalogError": A2uiCatalogError,
    "ValidationError": A2uiValidationError,
}


def _load_cases(suite: str) -> list[Any]:
  cases = load_conformance_yaml(suite)
  assert isinstance(cases, list) and cases, f"Empty suite: {suite}"
  return case_params(suite, cases)


@pytest.mark.parametrize("suite, case", _load_cases(_SUITE))
def test_renderer_capabilities_conformance(
    suite: str, case: dict[str, Any]
) -> None:
  del suite
  assert case["action"] == "read_renderer_capabilities"
  assert_known_keys(case, _CASE_KEYS, "read_renderer_capabilities case")
  args = case["args"]
  metadata = args.get("metadata")
  version = args["version"]

  if "expect_error" in case:
    assert_known_keys(case["expect_error"], _EXPECT_ERROR_KEYS, "expect_error")
    with pytest.raises(
        _ERROR_CATEGORIES[case["expect_error"]["category"]],
        match=case["expect_error"].get("message"),
    ):
      read_renderer_capabilities(metadata, version)
    return

  result = read_renderer_capabilities(metadata, version)
  assert result == case["expect"]
