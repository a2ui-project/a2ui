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

"""Runs the shared `conformance/agent/thinking.yaml` suite."""

import pytest

from a2ui.processor import remove_a2ui_thinking

from .conformance_helpers import load_conformance_yaml

cases = load_conformance_yaml("agent/thinking.yaml")


def test_thinking_suite_is_not_empty():
    assert cases


@pytest.mark.parametrize("case", cases, ids=[case["name"] for case in cases])
def test_thinking_conformance(case):
    assert case["action"] == "remove_a2ui_thinking"
    assert remove_a2ui_thinking(case["input"]) == case["expect"]
