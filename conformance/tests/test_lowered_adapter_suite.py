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

"""Tests that the lowered v0.9 adapter suite is up to date."""

from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "conformance" / "scripts"))

import lower_adapter_suite  # noqa: E402


def test_lowered_adapter_suite_up_to_date() -> None:
    """Verifies that conformance/adapter/adapter_conformance_v0_9.yaml matches lower_adapter_suite.py."""
    lower_adapter_suite.main(check=True)
